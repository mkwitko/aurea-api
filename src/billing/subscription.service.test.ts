import { describe, expect, it, vi } from 'vitest';
import { createSubscriptionService } from './subscription.service.js';
import type { BillingEvent } from './stripe-event.js';

const PERIOD_END = new Date('2026-08-01T00:00:00Z');
const NOW = new Date('2026-07-15T00:00:00Z');
const PERIOD_START = new Date('2026-07-01T00:00:00Z');

function org(overrides: Record<string, unknown> = {}) {
  return {
    id: 'org-1',
    name: 'Acme',
    plan: 'STARTER',
    subscriptionStatus: 'TRIAL',
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
    lastSyncedAt: null,
    ...overrides,
  };
}

// O período corrente é o que o serviço consulta para saber quanto a franquia
// congelada já entregou, e ele consulta DENTRO de uma transação: a leitura só
// vale travada junto com o lançamento. `null` = mês ainda não aberto (nenhum run
// rodou), e nesse caso não há linha para travar.
function periodsFake(allowance: number | null = 200, alreadyGranted: number | (() => number) = 0) {
  const tx = {
    lockOpenPeriod: vi
      .fn()
      .mockResolvedValue(allowance === null ? null : { id: 'cp-1', periodStart: PERIOD_START, allowance, consumed: 0 }),
    grantedInPeriodByReason: vi.fn(async () =>
      typeof alreadyGranted === 'function' ? alreadyGranted() : alreadyGranted,
    ),
  };
  return { transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)), tx };
}

function deps(organization = org(), periods = periodsFake()) {
  const repo = {
    organizationById: vi.fn().mockResolvedValue(organization),
    organizationByCustomerId: vi.fn().mockResolvedValue(organization),
    saveSubscription: vi.fn().mockResolvedValue(undefined),
    cancelSubscription: vi.fn().mockResolvedValue(undefined),
    workspaceBelongsTo: vi.fn().mockResolvedValue(true),
  };
  // grantOnce serve a compra de pacote; grantOnceIn serve o complemento de troca
  // de plano, que precisa lançar dentro da transação que travou o período.
  const credits = {
    grantOnce: vi.fn().mockResolvedValue(true),
    grantOnceIn: vi.fn().mockResolvedValue(true),
  };
  return { repo, credits, periods };
}

const purchase: BillingEvent = {
  kind: 'credit-purchase',
  sourceId: 'cs_1',
  customerId: 'cus_1',
  organizationId: 'org-1',
  workspaceId: 'ws-1',
  packId: 'MEDIUM',
};

function upgrade(plan: 'STARTER' | 'GROWTH' | 'SCALE', workspaceId: string | null = 'ws-1'): BillingEvent {
  return {
    kind: 'subscription-state',
    customerId: 'cus_1',
    subscriptionId: 'sub_1',
    plan,
    status: 'ACTIVE',
    currentPeriodEnd: PERIOD_END,
    workspaceId,
  };
}

describe('credit purchase', () => {
  it('grants the pack credits once, keyed by the session id', async () => {
    const d = deps();
    const service = createSubscriptionService(d as never);

    expect(await service.apply(purchase, NOW)).toBe('applied');
    expect(d.credits.grantOnce).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'cs_1', entryKind: 'PURCHASE', workspaceId: 'ws-1', credits: 500 }),
    );
  });

  // 'unresolved', não 'ignored': o dinheiro entrou e não foi creditado. Marcar
  // como processado joga fora a única recuperação automática que existe — a
  // janela de retry do Stripe.
  it('leaves the event unresolved when the metadata points at another organization', async () => {
    const d = deps();
    d.repo.workspaceBelongsTo.mockResolvedValue(false);
    const service = createSubscriptionService(d as never);

    expect(await service.apply(purchase, NOW)).toBe('unresolved');
    expect(d.credits.grantOnce).not.toHaveBeenCalled();
  });

  it('leaves the event unresolved when the organization has no stripe customer', async () => {
    const d = deps(org({ stripeCustomerId: null }));
    const service = createSubscriptionService(d as never);

    expect(await service.apply(purchase, NOW)).toBe('unresolved');
    expect(d.credits.grantOnce).not.toHaveBeenCalled();
  });

  // Spec §10: a organização do metadata tem que ser a dona do Customer que
  // PAGOU. Checar só que ela tem algum stripeCustomerId aceita um Payment Link
  // ou um comp do dashboard com metadata digitado à mão creditando outra org.
  it('credits nothing when the metadata organization does not own the customer that paid', async () => {
    const d = deps(org({ stripeCustomerId: 'cus_someone_else' }));
    const service = createSubscriptionService(d as never);

    expect(await service.apply(purchase, NOW)).toBe('unresolved');
    expect(d.credits.grantOnce).not.toHaveBeenCalled();
  });
});

describe('subscription state', () => {
  it('writes plan, status and period end', async () => {
    const d = deps();
    await createSubscriptionService(d as never).apply(upgrade('GROWTH'), NOW);

    expect(d.repo.saveSubscription).toHaveBeenCalledWith('org-1', {
      plan: 'GROWTH',
      status: 'ACTIVE',
      subscriptionId: 'sub_1',
      currentPeriodEnd: PERIOD_END,
    });
  });

  it('tops the frozen allowance up to the new plan when the plan goes up mid-period', async () => {
    const d = deps(org({ plan: 'STARTER', subscriptionStatus: 'ACTIVE' }), periodsFake(200));
    await createSubscriptionService(d as never).apply(upgrade('GROWTH'), NOW);

    // GROWTH 1000 − allowance congelado 200 − nada concedido ainda
    expect(d.credits.grantOnceIn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        idempotencyKey: 'sub_1:2026-08-01T00:00:00.000Z:GROWTH',
        eventType: 'plan-upgrade',
        entryKind: 'GRANT',
        workspaceId: 'ws-1',
        credits: 800,
      }),
    );
  });

  // Spec §7.4: a diferença só entra "com o período corrente já aberto". Sem
  // linha de período, o lockPeriod do B2a abre o mês já no allowance novo — um
  // GRANT aqui seria uma segunda franquia permanente em cima dessa.
  it('grants nothing when the current period was never opened, but still saves the state', async () => {
    const d = deps(org({ plan: 'STARTER', subscriptionStatus: 'TRIAL' }), periodsFake(null));
    await createSubscriptionService(d as never).apply(upgrade('GROWTH'), NOW);

    expect(d.credits.grantOnceIn).not.toHaveBeenCalled();
    expect(d.repo.saveSubscription).toHaveBeenCalledWith('org-1', {
      plan: 'GROWTH',
      status: 'ACTIVE',
      subscriptionId: 'sub_1',
      currentPeriodEnd: PERIOD_END,
    });
  });

  it('tops a trial period up to the full plan franchise, not beyond it', async () => {
    // Período aberto enquanto a org era TRIAL: allowance congelado em 0.
    const d = deps(org({ plan: 'STARTER', subscriptionStatus: 'TRIAL' }), periodsFake(0));
    await createSubscriptionService(d as never).apply(upgrade('STARTER'), NOW);

    expect(d.credits.grantOnceIn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ credits: 200 }));
  });

  it('discounts what the period already received instead of stacking a second full delta', async () => {
    // STARTER→GROWTH já lançou 800 neste período; o salto para SCALE completa
    // até 4000, não lança 3800 em cima dos 800.
    const d = deps(org({ plan: 'GROWTH', subscriptionStatus: 'ACTIVE' }), periodsFake(200, 800));
    await createSubscriptionService(d as never).apply(upgrade('SCALE'), NOW);

    expect(d.credits.grantOnceIn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ credits: 3_000 }));
  });

  it('grants nothing on a downgrade', async () => {
    const d = deps(org({ plan: 'SCALE', subscriptionStatus: 'ACTIVE' }), periodsFake(4_000));
    await createSubscriptionService(d as never).apply(upgrade('GROWTH'), NOW);

    expect(d.credits.grantOnceIn).not.toHaveBeenCalled();
  });

  it('grants nothing twice for the same state', async () => {
    const d = deps(org({ plan: 'GROWTH', subscriptionStatus: 'ACTIVE' }), periodsFake(1_000));
    await createSubscriptionService(d as never).apply(upgrade('GROWTH'), NOW);

    expect(d.credits.grantOnceIn).not.toHaveBeenCalled();
  });

  // A prova anti-empilhamento: dois pares de planos distintos e crescentes no
  // MESMO período não podem somar mais que a franquia do plano de cima. Este é
  // o buraco que o par de planos na chave de idempotência abria — cada par era
  // uma chave nova, e cada chave nova era uma franquia inteira a mais.
  it('cannot exceed the top plan franchise across two upward changes in one period', async () => {
    let granted = 0;
    const periods = periodsFake(200, () => granted);
    const d = deps(org({ plan: 'STARTER', subscriptionStatus: 'ACTIVE' }), periods);
    d.credits.grantOnceIn = vi.fn(async (_tx: unknown, input: { credits: number }) => {
      granted += input.credits;
      return true;
    }) as never;
    const service = createSubscriptionService(d as never);

    await service.apply(upgrade('SCALE'), NOW);
    await service.apply(upgrade('GROWTH'), NOW);
    await service.apply(upgrade('SCALE'), NOW);

    // 200 congelados + 3800 de GRANT = 4000, a franquia SCALE. Nada além.
    expect(granted).toBe(3_800);
  });

  // O gêmeo desta função no caminho de compra já checava o workspace; aqui o
  // grant ia direto para um workspaceId vindo do metadata, sem verificação. Além
  // do furo de confiança: um workspaceId que não resolve mais estoura FK dentro
  // do grantOnce, e como o grant vem antes do save, o Stripe reentrega o mesmo
  // evento para sempre com o estado da assinatura nunca gravado. Uma assinatura
  // travada é pior que um grant perdido.
  it('skips the grant but still saves the state when the workspace is outside the organization', async () => {
    const d = deps(org({ plan: 'STARTER', subscriptionStatus: 'ACTIVE' }), periodsFake(200));
    d.repo.workspaceBelongsTo.mockResolvedValue(false);

    expect(await createSubscriptionService(d as never).apply(upgrade('GROWTH'), NOW)).toBe('applied');
    expect(d.credits.grantOnceIn).not.toHaveBeenCalled();
    expect(d.repo.saveSubscription).toHaveBeenCalled();
  });

  // O Stripe não garante ordem e reentrega por até três dias: um `updated`
  // antigo redelivered não pode empurrar o plano de volta.
  it('ignores an event for another subscription whose period already ended earlier', async () => {
    const d = deps(
      org({
        plan: 'SCALE',
        subscriptionStatus: 'ACTIVE',
        stripeSubscriptionId: 'sub_2',
        currentPeriodEnd: new Date('2026-09-01T00:00:00Z'),
      }),
    );

    expect(await createSubscriptionService(d as never).apply(upgrade('STARTER'), NOW)).toBe('ignored');
    expect(d.repo.saveSubscription).not.toHaveBeenCalled();
    expect(d.credits.grantOnceIn).not.toHaveBeenCalled();
  });

  it('applies an event for another subscription when its period ends later: it is the new one', async () => {
    const d = deps(
      org({
        plan: 'STARTER',
        subscriptionStatus: 'CANCELED',
        stripeSubscriptionId: 'sub_0',
        currentPeriodEnd: new Date('2026-07-05T00:00:00Z'),
      }),
      periodsFake(0),
    );

    expect(await createSubscriptionService(d as never).apply(upgrade('GROWTH'), NOW)).toBe('applied');
    expect(d.repo.saveSubscription).toHaveBeenCalled();
  });

  it('skips the delta when the subscription carries no workspace', async () => {
    const d = deps(org({ plan: 'STARTER', subscriptionStatus: 'ACTIVE' }));
    await createSubscriptionService(d as never).apply(upgrade('GROWTH', null), NOW);

    expect(d.repo.saveSubscription).toHaveBeenCalled();
    expect(d.credits.grantOnceIn).not.toHaveBeenCalled();
  });

  // Customer desconhecido é "ainda não sei resolver", não "não é meu": pode ser a
  // corrida da reivindicação do Customer (C2) ainda não commitada. Retry resolve.
  it('leaves an unknown customer unresolved so stripe retries', async () => {
    const d = deps();
    d.repo.organizationByCustomerId.mockResolvedValue(null);

    expect(await createSubscriptionService(d as never).apply(upgrade('GROWTH'), NOW)).toBe('unresolved');
    expect(d.repo.saveSubscription).not.toHaveBeenCalled();
  });

  it('grants the credit before saving the new subscription state', async () => {
    const order: string[] = [];
    const organization = org({ plan: 'STARTER', subscriptionStatus: 'ACTIVE' });
    const repo = {
      organizationById: vi.fn().mockResolvedValue(organization),
      organizationByCustomerId: vi.fn().mockResolvedValue(organization),
      saveSubscription: vi.fn().mockImplementation(async () => {
        order.push('save');
      }),
      cancelSubscription: vi.fn().mockResolvedValue(undefined),
      workspaceBelongsTo: vi.fn().mockResolvedValue(true),
    };
    const credits = {
      grantOnceIn: vi.fn().mockImplementation(async () => {
        order.push('grant');
        return true;
      }),
    };
    const service = createSubscriptionService({ repo, credits, periods: periodsFake(200) } as never);

    await service.apply(upgrade('GROWTH'), NOW);

    expect(order).toEqual(['grant', 'save']);
  });

  it('retries after a partial failure without granting twice', async () => {
    // Mesma organização nas duas chamadas: o primeiro saveSubscription falha,
    // então o plano gravado continua STARTER quando o Stripe reentrega. O que
    // barra o crédito em dobro na segunda passada é o extrato — o lançamento da
    // primeira já está commitado e entra na conta como já concedido.
    const organization = org({ plan: 'STARTER', subscriptionStatus: 'ACTIVE' });
    let granted = 0;
    const repo = {
      organizationById: vi.fn().mockResolvedValue(organization),
      organizationByCustomerId: vi.fn().mockResolvedValue(organization),
      saveSubscription: vi.fn().mockRejectedValueOnce(new Error('connection blip')).mockResolvedValueOnce(undefined),
      cancelSubscription: vi.fn().mockResolvedValue(undefined),
      workspaceBelongsTo: vi.fn().mockResolvedValue(true),
    };
    const credits = {
      grantOnceIn: vi.fn(async (_tx: unknown, input: { credits: number }) => {
        granted += input.credits;
        return true;
      }),
    };
    const service = createSubscriptionService({ repo, credits, periods: periodsFake(200, () => granted) } as never);

    await expect(service.apply(upgrade('GROWTH'), NOW)).rejects.toThrow('connection blip');
    await service.apply(upgrade('GROWTH'), NOW);

    expect(credits.grantOnceIn).toHaveBeenCalledTimes(1);
    expect(granted).toBe(800);
    expect(repo.saveSubscription).toHaveBeenCalledTimes(2);
  });

  // A chave não pode depender do plano GRAVADO: numa reentrega concorrente da
  // mesma troca, as duas cópias precisam colidir na mesma chave — é o que
  // impede o crédito em dobro antes de qualquer uma commitar seu lançamento.
  it('keys the grant by subscription, period and target plan only', async () => {
    const d = deps(org({ plan: 'STARTER', subscriptionStatus: 'ACTIVE' }), periodsFake(200));
    await createSubscriptionService(d as never).apply(upgrade('GROWTH'), NOW);

    expect(d.credits.grantOnceIn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ idempotencyKey: `sub_1:${PERIOD_END.toISOString()}:GROWTH` }),
    );
  });
});

describe('cancellation', () => {
  it('marks the organization canceled', async () => {
    const d = deps(org({ stripeSubscriptionId: 'sub_1' }));
    await createSubscriptionService(d as never).apply(
      { kind: 'subscription-canceled', customerId: 'cus_1', subscriptionId: 'sub_1' },
      NOW,
    );

    expect(d.repo.cancelSubscription).toHaveBeenCalledWith('org-1');
  });

  // `deleted` chegando antes de qualquer `created`/`updated` — o Stripe não
  // garante ordem. Com o id gravado ainda nulo, exigir igualdade descartava o
  // evento para sempre: 'ignored' recebe marca de processado e não há retry. Nulo
  // é "ainda não sei qual é", não "é outra", igual à guarda de ordem do applyState.
  it('accepts a deletion when the organization has no subscription id recorded yet', async () => {
    const d = deps(org({ stripeSubscriptionId: null, subscriptionStatus: 'ACTIVE' }));

    const result = await createSubscriptionService(d as never).apply(
      { kind: 'subscription-canceled', customerId: 'cus_1', subscriptionId: 'sub_1' },
      NOW,
    );

    expect(result).toBe('applied');
    expect(d.repo.cancelSubscription).toHaveBeenCalledWith('org-1');
  });

  // Cancela sub_1, reassina em sub_2, e o `deleted` atrasado de sub_1 chega
  // depois: cancelar sem olhar qual assinatura morreu zera a franquia de um
  // cliente pagante até alguém lembrar de chamar o sync.
  it('ignores a deletion for a subscription that is not the stored one', async () => {
    const d = deps(org({ stripeSubscriptionId: 'sub_2', subscriptionStatus: 'ACTIVE' }));

    const result = await createSubscriptionService(d as never).apply(
      { kind: 'subscription-canceled', customerId: 'cus_1', subscriptionId: 'sub_1' },
      NOW,
    );

    expect(result).toBe('ignored');
    expect(d.repo.cancelSubscription).not.toHaveBeenCalled();
  });
});

describe('ignored events', () => {
  it('does nothing and does not throw', async () => {
    const d = deps();
    expect(await createSubscriptionService(d as never).apply({ kind: 'ignored', reason: 'x' }, NOW)).toBe('ignored');
  });
});

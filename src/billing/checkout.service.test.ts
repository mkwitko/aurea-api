import { describe, expect, it, vi } from 'vitest';
import { env } from '../config/env.js';
import type { OrgBilling } from './billing.repository.js';
import { createCheckoutService } from './checkout.service.js';
import { createSubscriptionService } from './subscription.service.js';
import { eventFromSnapshot } from './stripe-event.js';
import type { SubscriptionSnapshot } from './stripe-client.js';

const ORG = {
  id: 'org-1',
  name: 'Acme',
  plan: 'STARTER' as const,
  subscriptionStatus: 'TRIAL' as const,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  currentPeriodEnd: null,
  lastSyncedAt: null,
};

// Anotado como OrgBilling (em vez de deixar o tipo inferir de ORG): os campos
// nulos de ORG inferem como literal `null`, e os testes abaixo sobrescrevem
// stripeCustomerId com string — o parâmetro precisa aceitar `string | null`.
function deps(organization: OrgBilling = ORG) {
  const repo = {
    organizationById: vi.fn().mockResolvedValue(organization),
    // A gravação é uma reivindicação, não uma sobrescrita: devolve o id que
    // realmente ficou na organização, que pode não ser o que acabou de nascer.
    claimCustomerId: vi.fn(async (_organizationId: string, customerId: string) => customerId),
    touchSync: vi.fn().mockResolvedValue(undefined),
  };
  const stripe = {
    ensureCustomer: vi.fn().mockResolvedValue('cus_new'),
    createSubscriptionCheckout: vi.fn().mockResolvedValue({ url: 'https://checkout/sub' }),
    createPackCheckout: vi.fn().mockResolvedValue({ url: 'https://checkout/pack' }),
    createPortalSession: vi.fn().mockResolvedValue({ url: 'https://portal' }),
    fetchSubscription: vi.fn().mockResolvedValue(null),
    listRecentPaidSessions: vi.fn().mockResolvedValue([]),
    changeSubscriptionPlan: vi.fn().mockResolvedValue({
      subscriptionId: 'sub_1',
      priceId: 'price_test_growth',
      status: 'active',
      currentPeriodEnd: new Date('2026-08-01T00:00:00Z'),
      metadata: { organizationId: 'org-1', workspaceId: 'ws-1' },
    }),
  };
  const subscriptions = { apply: vi.fn().mockResolvedValue('applied') };
  return { repo, stripe, subscriptions };
}

describe('subscriptionUrl', () => {
  it('creates the customer once and stores it', async () => {
    const d = deps();
    const url = await createCheckoutService(d as never).subscriptionUrl({
      organizationId: 'org-1',
      workspaceId: 'ws-1',
      plan: 'GROWTH',
      email: 'owner@acme.com',
    });

    expect(url).toBe('https://checkout/sub');
    expect(d.repo.claimCustomerId).toHaveBeenCalledWith('org-1', 'cus_new');
    expect(d.stripe.createSubscriptionCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus_new',
        priceId: 'price_test_growth',
        organizationId: 'org-1',
        workspaceId: 'ws-1',
      }),
    );
  });

  it('reuses the stored customer', async () => {
    const d = deps({ ...ORG, stripeCustomerId: 'cus_old' });
    await createCheckoutService(d as never).subscriptionUrl({
      organizationId: 'org-1',
      workspaceId: 'ws-1',
      plan: 'STARTER',
      email: 'owner@acme.com',
    });

    expect(d.stripe.ensureCustomer).not.toHaveBeenCalled();
    expect(d.repo.claimCustomerId).not.toHaveBeenCalled();
  });

  // Duas assinaturas concorrentes numa org que nunca chegou ao Stripe: a
  // reivindicação só grava sobre stripeCustomerId nulo, então uma das duas perde
  // e recebe de volta o id do vencedor. Seguir com o id que ela mesma criou
  // abriria a Checkout Session num Customer que o banco não conhece — o
  // pagamento chegaria como evento de um customer desconhecido.
  it('checks out on the customer the claim stored, not the one it just created', async () => {
    const d = deps();
    d.repo.claimCustomerId = vi.fn().mockResolvedValue('cus_winner');

    await createCheckoutService(d as never).subscriptionUrl({
      organizationId: 'org-1',
      workspaceId: 'ws-1',
      plan: 'GROWTH',
      email: 'owner@acme.com',
    });

    expect(d.stripe.createSubscriptionCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cus_winner' }),
    );
  });
});

describe('creditPackUrl', () => {
  it('sends the pack id along so the webhook knows what to credit', async () => {
    const d = deps({ ...ORG, stripeCustomerId: 'cus_old' });
    await createCheckoutService(d as never).creditPackUrl({
      organizationId: 'org-1',
      workspaceId: 'ws-1',
      packId: 'LARGE',
      email: 'owner@acme.com',
    });

    expect(d.stripe.createPackCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ packId: 'LARGE', priceId: 'price_test_pack_large' }),
    );
  });
});

// Price não configurado é falha de operação nossa, e spec §9 dá um nome a ela:
// BILLING_NOT_CONFIGURED, 500. Antes eram dois erros diferentes para a mesma
// causa — 404 com a string interna "no stripe price configured for GROWTH" no
// corpo da resposta para o plano, e 400 UNKNOWN_CREDIT_PACK para o pacote, que
// culpa o cliente por um id que ele nem escolheu errado.
describe('unconfigured prices', () => {
  async function withoutPrices(fn: () => Promise<unknown>): Promise<void> {
    const mutable = env as { STRIPE_PRICE_GROWTH?: string; STRIPE_PRICE_PACK_SMALL?: string };
    const [plan, pack] = [mutable.STRIPE_PRICE_GROWTH, mutable.STRIPE_PRICE_PACK_SMALL];
    mutable.STRIPE_PRICE_GROWTH = undefined;
    mutable.STRIPE_PRICE_PACK_SMALL = undefined;
    try {
      await fn();
    } finally {
      mutable.STRIPE_PRICE_GROWTH = plan;
      mutable.STRIPE_PRICE_PACK_SMALL = pack;
    }
  }

  it('reports the same misconfiguration error for a plan and for a pack', async () => {
    const d = deps({ ...ORG, stripeCustomerId: 'cus_old' });
    const service = createCheckoutService(d as never);

    await withoutPrices(async () => {
      await expect(
        service.subscriptionUrl({ organizationId: 'org-1', workspaceId: 'ws-1', plan: 'GROWTH', email: 'o@a.com' }),
      ).rejects.toMatchObject({ code: 'AUR-T0016', statusCode: 500 });

      await expect(
        service.creditPackUrl({ organizationId: 'org-1', workspaceId: 'ws-1', packId: 'SMALL', email: 'o@a.com' }),
      ).rejects.toMatchObject({ code: 'AUR-T0016', statusCode: 500 });
    });
  });

  it('never leaks the internal price message into the error', async () => {
    const d = deps({ ...ORG, stripeCustomerId: 'cus_old' });
    const service = createCheckoutService(d as never);

    await withoutPrices(async () => {
      await expect(
        service.subscriptionUrl({ organizationId: 'org-1', workspaceId: 'ws-1', plan: 'GROWTH', email: 'o@a.com' }),
      ).rejects.not.toThrow(/stripe price/);
    });
  });
});

describe('sync', () => {
  it('feeds the subscription and the paid sessions through the same handlers', async () => {
    const d = deps({ ...ORG, stripeCustomerId: 'cus_old' });
    d.stripe.fetchSubscription.mockResolvedValue({
      subscriptionId: 'sub_1',
      priceId: 'price_test_growth',
      status: 'active',
      currentPeriodEnd: new Date('2026-08-01T00:00:00Z'),
      metadata: { workspaceId: 'ws-1' },
    });
    d.stripe.listRecentPaidSessions.mockResolvedValue([
      { sessionId: 'cs_1', metadata: { organizationId: 'org-1', workspaceId: 'ws-1', packId: 'SMALL' } },
    ]);

    await createCheckoutService(d as never).sync({ organizationId: 'org-1', now: new Date('2026-07-15T00:00:00Z') });

    expect(d.subscriptions.apply).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'subscription-state', plan: 'GROWTH' }),
      expect.any(Date),
    );
    expect(d.subscriptions.apply).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'credit-purchase', sourceId: 'cs_1' }),
      expect.any(Date),
    );
    expect(d.repo.touchSync).toHaveBeenCalled();
  });

  it('does nothing for an organization that never reached stripe', async () => {
    const d = deps();
    await createCheckoutService(d as never).sync({ organizationId: 'org-1', now: new Date() });

    expect(d.stripe.fetchSubscription).not.toHaveBeenCalled();
    expect(d.subscriptions.apply).not.toHaveBeenCalled();
  });
});

// Achado crítico da revisão: POST /billing/checkout/subscription só sabe CRIAR
// assinatura (mode: 'subscription'), então "trocar de plano" nele abria uma
// segunda Checkout Session numa organização já ACTIVE — o cliente pagava as
// duas ao mesmo tempo, e o webhook sobrescrevia stripeSubscriptionId com a
// nova, deixando a antiga faturando escondida. changePlan usa
// stripe.changeSubscriptionPlan (subscriptions.update com proração) e aplica o
// resultado pelo MESMO caminho do webhook.
describe('changePlan', () => {
  const SUBSCRIBED = {
    ...ORG,
    plan: 'STARTER' as const,
    subscriptionStatus: 'ACTIVE' as const,
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: 'sub_1',
    currentPeriodEnd: new Date('2026-08-01T00:00:00Z'),
  };

  function snapshotFor(plan: 'STARTER' | 'GROWTH' | 'SCALE'): SubscriptionSnapshot {
    const priceId = { STARTER: 'price_test_starter', GROWTH: 'price_test_growth', SCALE: 'price_test_scale' }[plan];
    return {
      subscriptionId: 'sub_1',
      priceId,
      status: 'active',
      currentPeriodEnd: new Date('2026-08-01T00:00:00Z'),
      metadata: { organizationId: 'org-1', workspaceId: 'ws-1' },
    };
  }

  async function withoutGrowthPrice(fn: () => Promise<unknown>): Promise<void> {
    const mutable = env as { STRIPE_PRICE_GROWTH?: string };
    const stored = mutable.STRIPE_PRICE_GROWTH;
    mutable.STRIPE_PRICE_GROWTH = undefined;
    try {
      await fn();
    } finally {
      mutable.STRIPE_PRICE_GROWTH = stored;
    }
  }

  it('refuses an organization with no subscription id recorded, and never calls stripe', async () => {
    const d = deps({ ...SUBSCRIBED, stripeSubscriptionId: null });
    const service = createCheckoutService(d as never);

    await expect(
      service.changePlan({ organizationId: 'org-1', plan: 'SCALE', now: new Date() }),
    ).rejects.toMatchObject({ code: 'AUR-T0019', statusCode: 409 });
    expect(d.stripe.changeSubscriptionPlan).not.toHaveBeenCalled();
  });

  it('refuses a subscription that is neither ACTIVE nor PAST_DUE, and never calls stripe', async () => {
    const d = deps({ ...SUBSCRIBED, subscriptionStatus: 'CANCELED' });
    const service = createCheckoutService(d as never);

    await expect(
      service.changePlan({ organizationId: 'org-1', plan: 'SCALE', now: new Date() }),
    ).rejects.toMatchObject({ code: 'AUR-T0019', statusCode: 409 });
    expect(d.stripe.changeSubscriptionPlan).not.toHaveBeenCalled();
  });

  it('accepts a PAST_DUE subscription — still charging, just retrying', async () => {
    const d = deps({ ...SUBSCRIBED, subscriptionStatus: 'PAST_DUE' });
    d.stripe.changeSubscriptionPlan.mockResolvedValue(snapshotFor('SCALE'));
    const service = createCheckoutService(d as never);

    await service.changePlan({ organizationId: 'org-1', plan: 'SCALE', now: new Date() });
    expect(d.stripe.changeSubscriptionPlan).toHaveBeenCalled();
  });

  it('yields BILLING_NOT_CONFIGURED when the target plan price is missing, without calling stripe', async () => {
    const d = deps(SUBSCRIBED);
    const service = createCheckoutService(d as never);

    await withoutGrowthPrice(async () => {
      await expect(
        service.changePlan({ organizationId: 'org-1', plan: 'GROWTH', now: new Date() }),
      ).rejects.toMatchObject({ code: 'AUR-T0016', statusCode: 500 });
    });
    expect(d.stripe.changeSubscriptionPlan).not.toHaveBeenCalled();
  });

  it('updates the existing subscription item on the price of the target plan, and applies the resulting snapshot', async () => {
    const d = deps(SUBSCRIBED);
    d.stripe.changeSubscriptionPlan.mockResolvedValue(snapshotFor('SCALE'));
    const service = createCheckoutService(d as never);

    await service.changePlan({ organizationId: 'org-1', plan: 'SCALE', now: new Date('2026-07-15T00:00:00Z') });

    expect(d.stripe.changeSubscriptionPlan).toHaveBeenCalledWith({
      subscriptionId: 'sub_1',
      priceId: 'price_test_scale',
    });
    expect(d.subscriptions.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'subscription-state',
        customerId: 'cus_1',
        subscriptionId: 'sub_1',
        plan: 'SCALE',
        workspaceId: 'ws-1',
      }),
      expect.any(Date),
    );
  });

  // A partir daqui, subscriptions NÃO é mais mockado: é o subscription.service
  // de verdade, com fakes só no repo/credits/period — para provar a MATEMÁTICA
  // do delta e a IDEMPOTÊNCIA de verdade, não apenas que apply foi chamado.
  function periodsFake(allowance: number | null, alreadyGranted: number | (() => number) = 0) {
    const tx = {
      lockOpenPeriod: vi
        .fn()
        .mockResolvedValue(
          allowance === null
            ? null
            : { id: 'cp-1', periodStart: new Date('2026-07-01T00:00:00Z'), allowance, consumed: 0 },
        ),
      grantedInPeriodByReason: vi.fn(async () =>
        typeof alreadyGranted === 'function' ? alreadyGranted() : alreadyGranted,
      ),
    };
    return { transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
  }

  function billingRepoFake(organization: OrgBilling) {
    return {
      organizationById: vi.fn().mockResolvedValue(organization),
      organizationByCustomerId: vi.fn().mockResolvedValue(organization),
      saveSubscription: vi.fn().mockResolvedValue(undefined),
      workspaceBelongsTo: vi.fn().mockResolvedValue(true),
    };
  }

  it('grants nothing on a downgrade', async () => {
    const repo = billingRepoFake(SUBSCRIBED);
    const credits = { grantOnce: vi.fn(), grantOnceIn: vi.fn().mockResolvedValue(true) };
    // Allowance congelado já no teto do SCALE: nada resta para uma queda a GROWTH.
    const subscriptions = createSubscriptionService({ repo, credits, periods: periodsFake(4_000) } as never);
    const stripe = { changeSubscriptionPlan: vi.fn().mockResolvedValue(snapshotFor('GROWTH')) };
    const service = createCheckoutService({ repo, stripe, subscriptions } as never);

    await service.changePlan({ organizationId: 'org-1', plan: 'GROWTH', now: new Date('2026-07-15T00:00:00Z') });

    expect(credits.grantOnceIn).not.toHaveBeenCalled();
  });

  it('grants exactly the difference on an upgrade', async () => {
    const repo = billingRepoFake(SUBSCRIBED);
    const credits = { grantOnce: vi.fn(), grantOnceIn: vi.fn().mockResolvedValue(true) };
    // Allowance congelado no STARTER (200): GROWTH (1000) − 200 − 0 = 800.
    const subscriptions = createSubscriptionService({ repo, credits, periods: periodsFake(200) } as never);
    const stripe = { changeSubscriptionPlan: vi.fn().mockResolvedValue(snapshotFor('GROWTH')) };
    const service = createCheckoutService({ repo, stripe, subscriptions } as never);

    await service.changePlan({ organizationId: 'org-1', plan: 'GROWTH', now: new Date('2026-07-15T00:00:00Z') });

    expect(credits.grantOnceIn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ credits: 800, entryKind: 'GRANT', workspaceId: 'ws-1' }),
    );
  });

  // A prova de idempotência que o achado crítico exige: o Stripe entrega
  // customer.subscription.updated para ESTA MESMA troca (é a rota E o webhook
  // reagindo ao mesmo objeto do Stripe). grantOnceIn aqui simula a marca real
  // (INSERT ... ON CONFLICT DO NOTHING de credit.repository.markStripeEvent):
  // a segunda tentativa com a MESMA chave de idempotência não credita de novo.
  it('grants the upgrade delta exactly once across the route call and the equivalent webhook redelivery', async () => {
    const repo = billingRepoFake(SUBSCRIBED);
    const seenKeys = new Set<string>();
    let grantsCommitted = 0;
    const credits = {
      grantOnce: vi.fn(),
      grantOnceIn: vi.fn(async (_tx: unknown, input: { idempotencyKey: string; credits: number }) => {
        if (seenKeys.has(input.idempotencyKey)) return false;
        seenKeys.add(input.idempotencyKey);
        grantsCommitted += 1;
        return true;
      }),
    };
    const subscriptions = createSubscriptionService({ repo, credits, periods: periodsFake(200) } as never);
    const snapshot = snapshotFor('GROWTH');
    const stripe = { changeSubscriptionPlan: vi.fn().mockResolvedValue(snapshot) };
    const service = createCheckoutService({ repo, stripe, subscriptions } as never);

    // A rota: POST /billing/subscription/plan chama changePlan uma vez.
    await service.changePlan({ organizationId: 'org-1', plan: 'GROWTH', now: new Date('2026-07-15T00:00:00Z') });

    // O webhook: customer.subscription.updated entrega o MESMO snapshot que o
    // Stripe acabou de devolver para a chamada acima — reusa o mesmo mapper
    // (eventFromSnapshot) que o webhook de produção usa, não uma segunda cópia.
    await subscriptions.apply(eventFromSnapshot('cus_1', snapshot), new Date('2026-07-15T00:00:01Z'));

    expect(credits.grantOnceIn).toHaveBeenCalledTimes(2);
    expect(grantsCommitted).toBe(1);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { Plan, SubscriptionStatus } from '@prisma/client';
import { createCreditService, startOfMonthUtc } from './credit.service.js';
import type { CreditRepository } from './credit.repository.js';
import { effectiveAllowance } from './plan-catalog.js';

const NOW = new Date('2026-07-15T10:00:00Z');
const PERIOD = new Date('2026-07-01T00:00:00Z');

function repoFake(
  over: { allowance?: number; consumed?: number; purchased?: number; plan?: Plan; status?: SubscriptionStatus } = {},
) {
  const plan = over.plan ?? 'STARTER';
  const status = over.status ?? 'ACTIVE';
  // A franquia canônica que a fake devolve é a mesma conta que o serviço real
  // faz: sem isso o fake mente sobre o efeito de status TRIAL/CANCELED.
  const franchise = over.allowance ?? effectiveAllowance(plan, status);

  const tx = {
    lockPeriod: vi.fn().mockResolvedValue({
      id: 'p-1',
      periodStart: PERIOD,
      allowance: franchise,
      consumed: over.consumed ?? 0,
    }),
    purchasedBalance: vi.fn().mockResolvedValue(over.purchased ?? 0),
    addConsumed: vi.fn().mockResolvedValue(undefined),
    insertEntry: vi.fn().mockResolvedValue({ id: 'l-1' }),
    findEntryByRun: vi.fn().mockResolvedValue(null),
    findPeriod: vi.fn().mockResolvedValue({ id: 'p-1', periodStart: PERIOD, allowance: 200, consumed: 5 }),
  };
  const repo = {
    transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    workspaceBilling: vi.fn().mockResolvedValue({ plan, status }),
    workspaceOfRun: vi.fn().mockResolvedValue('ws-1'),
    purchasedBalance: vi.fn().mockResolvedValue(over.purchased ?? 0),
    findPeriod: vi.fn().mockResolvedValue({ id: 'p-1', periodStart: PERIOD, allowance: franchise, consumed: 5 }),
    listLedger: vi.fn().mockResolvedValue([]),
  };
  return { repo, tx, service: createCreditService({ repo: repo as unknown as CreditRepository }) };
}

const charge = { workspaceId: 'ws-1', taskType: 'summarize-business-context', agentRunId: 'run-1', now: NOW };

describe('startOfMonthUtc', () => {
  it('floors to the first day of the month in UTC', () => {
    expect(startOfMonthUtc(new Date('2026-07-31T23:59:59Z')).toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });
});

describe('authorizeAndCharge', () => {
  it('spends the allowance first', async () => {
    const { service, tx } = repoFake();

    const result = await service.authorizeAndCharge({ ...charge, byok: false });

    expect(result).toMatchObject({ allowed: true });
    const entry = tx.insertEntry.mock.calls[0]![0];
    expect(entry.credits).toBe(-1);
    expect(entry.fromAllowance).toBe(1);
    expect(entry.fromPurchased).toBe(0);
    expect(tx.addConsumed).toHaveBeenCalledWith('p-1', 1);
  });

  it('falls back to purchased credits when the allowance is spent', async () => {
    const { service, tx } = repoFake({ allowance: 1, consumed: 1, purchased: 5 });

    await service.authorizeAndCharge({ ...charge, byok: false });

    const entry = tx.insertEntry.mock.calls[0]![0];
    expect(entry.fromAllowance).toBe(0);
    expect(entry.fromPurchased).toBe(1);
    expect(tx.addConsumed).not.toHaveBeenCalled();
  });

  it('blocks with the numbers the UI needs, writing nothing', async () => {
    const { service, tx } = repoFake({ allowance: 1, consumed: 1, purchased: 0 });

    const result = await service.authorizeAndCharge({ ...charge, byok: false });

    expect(result).toEqual({ allowed: false, required: 1, available: 0 });
    expect(tx.insertEntry).not.toHaveBeenCalled();
  });

  it('never charges a BYOK workspace', async () => {
    const { service, repo } = repoFake();

    const result = await service.authorizeAndCharge({ ...charge, byok: true });

    expect(result).toEqual({ allowed: true, charge: null });
    expect(repo.transaction).not.toHaveBeenCalled();
  });
});

describe('refund', () => {
  it('returns each bucket what it paid', async () => {
    const { service, tx } = repoFake();
    tx.findEntryByRun
      .mockResolvedValueOnce({ id: 'l-1', credits: -9, fromAllowance: 5, fromPurchased: 4, createdAt: new Date('2026-07-10T00:00:00Z') })
      .mockResolvedValueOnce(null);

    await service.refund({ agentRunId: 'run-1', now: NOW });

    expect(tx.addConsumed).toHaveBeenCalledWith('p-1', -5);
    const entry = tx.insertEntry.mock.calls[0]![0];
    expect(entry).toMatchObject({ kind: 'REFUND', credits: 9, fromAllowance: 5, fromPurchased: 4 });
  });

  it('does nothing when the run was never charged', async () => {
    const { service, tx } = repoFake();

    await service.refund({ agentRunId: 'run-1', now: NOW });

    expect(tx.insertEntry).not.toHaveBeenCalled();
  });

  it('does not refund twice', async () => {
    const { service, tx } = repoFake();
    tx.findEntryByRun
      .mockResolvedValueOnce({ id: 'l-1', credits: -1, fromAllowance: 1, fromPurchased: 0, createdAt: new Date('2026-07-10T00:00:00Z') })
      .mockResolvedValueOnce({ id: 'l-2', credits: 1, fromAllowance: 1, fromPurchased: 0, createdAt: NOW });

    await service.refund({ agentRunId: 'run-1', now: NOW });

    expect(tx.insertEntry).not.toHaveBeenCalled();
  });

  it('credits the allowance back to the period that charged it', async () => {
    const { service, tx } = repoFake();
    tx.findEntryByRun
      .mockResolvedValueOnce({ id: 'l-1', credits: -1, fromAllowance: 1, fromPurchased: 0, createdAt: new Date('2026-06-30T23:00:00Z') })
      .mockResolvedValueOnce(null);

    await service.refund({ agentRunId: 'run-1', now: NOW });

    expect(tx.findPeriod).toHaveBeenCalledWith('ws-1', new Date('2026-06-01T00:00:00Z'));
  });
});

describe('grant', () => {
  it('records a positive entry with the reason as the audit trail', async () => {
    const { service, tx } = repoFake();

    await service.grant({ workspaceId: 'ws-1', credits: 500, reason: 'support credit' });

    expect(tx.insertEntry.mock.calls[0]![0]).toMatchObject({
      kind: 'GRANT',
      credits: 500,
      reason: 'support credit',
    });
  });

  it('refuses a non-positive grant', async () => {
    const { service } = repoFake();
    await expect(service.grant({ workspaceId: 'ws-1', credits: 0, reason: 'x' })).rejects.toThrow();
  });
});

describe('grantOnce', () => {
  it('grants on the first delivery and refuses the second', async () => {
    const marks = new Set<string>();
    const entries: { kind: string }[] = [];
    const { repo } = repoFake();
    const grantOnceRepo = {
      ...repo,
      transaction: async (fn: (tx: never) => Promise<unknown>) =>
        fn({
          markStripeEvent: async (id: string) => (marks.has(id) ? false : (marks.add(id), true)),
          insertEntry: async (entry: { kind: string }) => (entries.push(entry), { id: 'l-1' }),
        } as never),
    };
    const service = createCreditService({ repo: grantOnceRepo as unknown as CreditRepository });

    const input = {
      idempotencyKey: 'cs_123',
      eventType: 'checkout.session.completed',
      entryKind: 'PURCHASE' as const,
      workspaceId: 'ws-1',
      credits: 100,
      reason: 'credit pack MEDIUM',
    };

    expect(await service.grantOnce(input)).toBe(true);
    expect(await service.grantOnce(input)).toBe(false);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe('PURCHASE');
  });

  // O kind escrito no ledger é o que veio em entryKind, não um valor fixo: uma
  // compra de pacote e um upgrade de plano usam o mesmo grantOnce, mas não
  // podem virar a mesma etiqueta no extrato do cliente.
  it('writes the ledger entry with the entry kind it was given, not a fixed one', async () => {
    const entries: { kind: string }[] = [];
    const { repo } = repoFake();
    const grantOnceRepo = {
      ...repo,
      transaction: async (fn: (tx: never) => Promise<unknown>) =>
        fn({
          markStripeEvent: async () => true,
          insertEntry: async (entry: { kind: string }) => (entries.push(entry), { id: 'l-1' }),
        } as never),
    };
    const service = createCreditService({ repo: grantOnceRepo as unknown as CreditRepository });

    await service.grantOnce({
      idempotencyKey: 'sub_1:STARTER->GROWTH:2026-08-01T00:00:00.000Z',
      eventType: 'plan-upgrade',
      entryKind: 'GRANT',
      workspaceId: 'ws-1',
      credits: 800,
      reason: 'plan change STARTER→GROWTH',
    });

    expect(entries[0]?.kind).toBe('GRANT');
  });

  it('refuses a non-positive grant', async () => {
    const { service } = repoFake();
    await expect(
      service.grantOnce({
        idempotencyKey: 'cs_1',
        eventType: 'x',
        entryKind: 'PURCHASE',
        workspaceId: 'ws-1',
        credits: 0,
        reason: 'x',
      }),
    ).rejects.toThrow();
  });
});

describe('summary', () => {
  it('reports the current period without creating one', async () => {
    const { service, repo } = repoFake({ purchased: 12 });

    const summary = await service.summary('ws-1', NOW);

    expect(summary).toMatchObject({ plan: 'STARTER', consumed: 5, purchasedBalance: 12 });
    expect(summary.periodStart.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(summary.periodEnd.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(repo.transaction).not.toHaveBeenCalled();
  });

  it('reports a full allowance for a workspace that never ran anything', async () => {
    const { service, repo } = repoFake();
    repo.findPeriod.mockResolvedValue(null);

    const summary = await service.summary('ws-1', NOW);

    expect(summary.allowance).toBe(200);
    expect(summary.consumed).toBe(0);
  });
});

describe('subscription status drives the allowance', () => {
  it('denies a canceled organization the plan allowance', async () => {
    const { service } = repoFake({ plan: 'GROWTH', status: 'CANCELED' });

    const result = await service.authorizeAndCharge({
      workspaceId: 'ws-1',
      taskType: 'summarize-business-context',
      agentRunId: 'run-1',
      byok: false,
      now: new Date('2026-07-15T00:00:00Z'),
    });

    expect(result).toMatchObject({ allowed: false, available: 0 });
  });

  it('keeps paying a past_due organization', async () => {
    const { service } = repoFake({ plan: 'GROWTH', status: 'PAST_DUE' });

    const result = await service.authorizeAndCharge({
      workspaceId: 'ws-1',
      taskType: 'summarize-business-context',
      agentRunId: 'run-1',
      byok: false,
      now: new Date('2026-07-15T00:00:00Z'),
    });

    expect(result).toMatchObject({ allowed: true });
  });

  it('reports the effective allowance in the summary', async () => {
    const { service } = repoFake({ plan: 'SCALE', status: 'TRIAL' });
    const summary = await service.summary('ws-1', new Date('2026-07-15T00:00:00Z'));

    expect(summary).toMatchObject({ plan: 'SCALE', allowance: 0 });
  });
});

describe('a run that was already charged', () => {
  it('authorizes without charging twice', async () => {
    // O BullMQ re-tenta um job que falhou depois da cobrança. Sem esta saída a
    // segunda tentativa batia na unique de (agentRunId, kind) e o job entrava
    // num laço de retry que nunca converge.
    const tx = {
      findEntryByRun: vi.fn().mockResolvedValue({ id: 'already-there' }),
      lockPeriod: vi.fn(),
      purchasedBalance: vi.fn(),
      addConsumed: vi.fn(),
      insertEntry: vi.fn(),
    };
    const repo = {
      workspaceBilling: vi.fn().mockResolvedValue({ plan: 'STARTER', status: 'ACTIVE' }),
      transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };

    const service = createCreditService({ repo: repo as never });
    const result = await service.authorizeAndCharge({
      workspaceId: 'w1',
      taskType: 'propose-icp',
      agentRunId: 'run-1',
      byok: false,
      now: new Date('2026-07-31T00:00:00Z'),
    });

    expect(result).toMatchObject({ allowed: true, charge: null });
    // O ponto todo: nada foi debitado de novo.
    expect(tx.insertEntry).not.toHaveBeenCalled();
    expect(tx.addConsumed).not.toHaveBeenCalled();
  });
});

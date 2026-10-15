import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createCreditRepository } from './credit.repository.js';

function fakePrisma() {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([
      { id: 'p-1', periodStart: new Date('2026-07-01T00:00:00Z'), allowance: 200, consumed: 0 },
    ]),
    creditPeriod: { update: vi.fn().mockResolvedValue({}), findUnique: vi.fn().mockResolvedValue(null) },
    creditLedger: {
      create: vi.fn().mockResolvedValue({ id: 'l-1' }),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    workspace: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ organization: { plan: 'GROWTH', subscriptionStatus: 'ACTIVE' } }),
    },
    agentRun: { findUniqueOrThrow: vi.fn().mockResolvedValue({ workspaceId: 'ws-9' }) },
  };
  return { prisma, tx };
}

describe('creditRepository', () => {
  it('creates the period if missing and then locks it', async () => {
    const { prisma, tx } = fakePrisma();
    const repo = createCreditRepository(prisma as unknown as PrismaClient);

    const period = await repo.transaction((t) =>
      t.lockPeriod('ws-1', new Date('2026-07-01T00:00:00Z'), 200),
    );

    expect(tx.$executeRaw).toHaveBeenCalled(); // INSERT ... ON CONFLICT DO NOTHING
    expect(tx.$queryRaw).toHaveBeenCalled(); // SELECT ... FOR UPDATE
    expect(period.id).toBe('p-1');
  });

  it('reads the plan and status from the organization the workspace belongs to', async () => {
    const { prisma } = fakePrisma();
    const repo = createCreditRepository(prisma as unknown as PrismaClient);

    expect(await repo.workspaceBilling('ws-1')).toEqual({ plan: 'GROWTH', status: 'ACTIVE' });
  });

  it('resolves the workspace of a run, so a refund knows where to land', async () => {
    const { prisma } = fakePrisma();
    const repo = createCreditRepository(prisma as unknown as PrismaClient);

    expect(await repo.workspaceOfRun('run-1')).toBe('ws-9');
  });

  it('records a debit with both buckets', async () => {
    const { prisma, tx } = fakePrisma();
    const repo = createCreditRepository(prisma as unknown as PrismaClient);

    await repo.transaction((t) =>
      t.insertEntry({
        workspaceId: 'ws-1',
        kind: 'DEBIT',
        credits: -9,
        fromAllowance: 5,
        fromPurchased: 4,
        agentRunId: 'run-1',
        reason: 'run run-1',
      }),
    );

    const data = tx.creditLedger.create.mock.calls[0]![0].data;
    expect(data.credits).toBe(-9);
    expect(data.fromAllowance).toBe(5);
    expect(data.fromPurchased).toBe(4);
  });

  it('pages the ledger newest first', async () => {
    const { prisma } = fakePrisma();
    const repo = createCreditRepository(prisma as unknown as PrismaClient);

    await repo.listLedger('ws-1', 20, new Date('2026-07-10T00:00:00Z'));

    const args = prisma.creditLedger.findMany.mock.calls[0]![0];
    expect(args.take).toBe(20);
    expect(args.orderBy[0]).toEqual({ createdAt: 'desc' });
    expect(args.where.createdAt).toEqual({ lt: new Date('2026-07-10T00:00:00Z') });
  });
});

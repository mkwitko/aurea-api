import { describe, expect, it, vi } from 'vitest';
import { createBusinessRepository } from './business.repository.js';

function prismaFake() {
  const version = { id: 'ver-2', version: 2 };
  const tx = {
    businessContext: {
      upsert: vi.fn().mockResolvedValue({ id: 'ctx-1', currentVersionId: 'ver-1' }),
      update: vi.fn().mockResolvedValue({}),
    },
    businessContextVersion: {
      count: vi.fn().mockResolvedValue(1),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue(version),
    },
  };
  return { tx, prisma: { $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)) } };
}

describe('addContextVersion', () => {
  it('records the agent run that produced the version', async () => {
    const { prisma, tx } = prismaFake();

    await createBusinessRepository(prisma as never).addContextVersion('biz-1', {
      data: { marketContext: { trends: ['x'] } },
      source: 'RESEARCH',
      confidence: 'MEDIUM',
      createdBy: 'u1',
      sourceAgentRunId: 'run-9',
    });

    expect(tx.businessContextVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sourceAgentRunId: 'run-9', version: 2 }) }),
    );
  });

  it('leaves it null for a hand-written version', async () => {
    const { prisma, tx } = prismaFake();

    await createBusinessRepository(prisma as never).addContextVersion('biz-1', {
      data: {},
      source: 'USER',
      confidence: 'MEDIUM',
      createdBy: 'u1',
    });

    const [[call]] = tx.businessContextVersion.create.mock.calls as [[{ data: Record<string, unknown> }]];
    expect(call.data.sourceAgentRunId).toBeUndefined();
  });
});

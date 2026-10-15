import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { purgeAgentRuns } from './purge-agent-runs.js';

describe('purgeAgentRuns', () => {
  it('deletes only terminal runs older than the cutoff', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 7 });
    const prisma = { agentRun: { deleteMany } } as unknown as PrismaClient;

    const deleted = await purgeAgentRuns(prisma, 90, new Date('2026-07-27T00:00:00Z'));

    expect(deleted).toBe(7);
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['COMPLETED', 'FAILED', 'CANCELLED'] },
        createdAt: { lt: new Date('2026-04-28T00:00:00Z') },
      },
    });
  });

  it('never deletes runs still pending or running', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    await purgeAgentRuns({ agentRun: { deleteMany } } as unknown as PrismaClient, 90, new Date());

    const statuses = deleteMany.mock.calls[0]![0].where.status.in;
    expect(statuses).not.toContain('PENDING');
    expect(statuses).not.toContain('RUNNING');
  });
});

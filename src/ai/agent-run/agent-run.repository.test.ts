import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createAgentRunRepository } from './agent-run.repository.js';

function fakePrisma() {
  return {
    agentRun: {
      create: vi.fn().mockResolvedValue({ id: 'run-1' }),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({ id: 'run-1' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    agentToolCall: { create: vi.fn().mockResolvedValue({ id: 'tc-1' }) },
  };
}

describe('agentRunRepository', () => {
  it('creates a PENDING run stamped with queuedAt', async () => {
    const prisma = fakePrisma();
    const repo = createAgentRunRepository(prisma as unknown as PrismaClient);

    await repo.create({
      workspaceId: 'ws-1',
      agentType: 'context-analyst',
      taskType: 'summarize-business-context',
      tier: 'TIER1',
      input: { businessId: 'b-1' },
      inputHash: 'hash-1',
      concurrencyKey: 'summarize-business-context:hash-1',
      requestedBy: 'user-1',
    });

    const data = prisma.agentRun.create.mock.calls[0]![0].data;
    expect(data.status).toBe('PENDING');
    expect(data.workspaceId).toBe('ws-1');
    expect(data.queuedAt).toBeInstanceOf(Date);
  });

  it('scopes findInWorkspace by workspaceId', async () => {
    const prisma = fakePrisma();
    const repo = createAgentRunRepository(prisma as unknown as PrismaClient);

    await repo.findInWorkspace('run-1', 'ws-1');

    expect(prisma.agentRun.findFirst).toHaveBeenCalledWith({
      where: { id: 'run-1', workspaceId: 'ws-1' },
      include: { toolCalls: { orderBy: { startedAt: 'asc' } } },
    });
  });

  it('looks for an active duplicate by workspace, taskType and hash', async () => {
    const prisma = fakePrisma();
    const repo = createAgentRunRepository(prisma as unknown as PrismaClient);

    await repo.findActiveByKey('ws-1', 'summarize-business-context:hash-1');

    expect(prisma.agentRun.findFirst).toHaveBeenCalledWith({
      where: {
        workspaceId: 'ws-1',
        concurrencyKey: 'summarize-business-context:hash-1',
        status: { in: ['PENDING', 'RUNNING'] },
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('writes usage and cost when completing a run', async () => {
    const prisma = fakePrisma();
    const repo = createAgentRunRepository(prisma as unknown as PrismaClient);

    await repo.markCompleted('run-1', {
      output: { summary: 'ok' },
      model: 'deepseek-chat',
      provider: 'deepseek',
      tier: 'TIER1',
      inputTokens: 100,
      cachedInputTokens: 40,
      outputTokens: 20,
      estimatedCost: 0.0001,
      modelCalls: 1,
    });

    // updateMany com filtro de status, não update por id: um run cancelado
    // pelo fundador não pode ser ressuscitado por um processo que terminou
    // depois do cancelamento.
    const args = prisma.agentRun.updateMany.mock.calls[0]![0];
    expect(args.where).toEqual({ id: 'run-1', status: { in: ['PENDING', 'RUNNING'] } });
    expect(args.data.status).toBe('COMPLETED');
    expect(args.data.completedAt).toBeInstanceOf(Date);
    expect(args.data.estimatedCost).toBe(0.0001);
  });

  it('records a failed tool call with its error', async () => {
    const prisma = fakePrisma();
    const repo = createAgentRunRepository(prisma as unknown as PrismaClient);

    await repo.recordToolCall({
      agentRunId: 'run-1',
      name: 'get_business_context',
      args: { sections: ['company'] },
      result: null,
      ok: false,
      error: 'invalid args',
      durationMs: 3,
      startedAt: new Date('2026-07-27T12:00:00Z'),
    });

    const data = prisma.agentToolCall.create.mock.calls[0]![0].data;
    expect(data.ok).toBe(false);
    expect(data.error).toBe('invalid args');
  });
});

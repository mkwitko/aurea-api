import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createGetLearningsTool } from './get-learnings.js';
import type { ToolContext } from './tool.js';

const tenant = { userId: 'u1', organizationId: 'o1', workspaceId: 'ws-1', role: 'OWNER' as const };

function ctxWith(rows: unknown[]) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const ctx: ToolContext = {
    tenant,
    prisma: { learning: { findMany } } as unknown as PrismaClient,
    signal: new AbortController().signal,
  };
  return { ctx, findMany };
}

function learning(overrides: Record<string, unknown> = {}) {
  return {
    id: 'l-1',
    title: 'Calling within 24h converts',
    statement: 'Trials called on day one convert twice as often.',
    confidence: 'HIGH',
    status: 'VALIDATED',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    experiment: {
      name: 'Day-one call',
      metric: 'trial_to_paid',
      baselineValue: 10,
      targetValue: 20,
      outcomes: [{ value: 15, unit: '%' }],
    },
    ...overrides,
  };
}

describe('get_learnings tool', () => {
  it('reads only this workspace, and only what a human confirmed', async () => {
    const { ctx, findMany } = ctxWith([]);

    await createGetLearningsTool().execute({}, ctx);

    const where = findMany.mock.calls[0]?.[0]?.where;
    expect(where.workspaceId).toBe('ws-1');
    // Um CANDIDATE é rascunho de IA que ninguém confirmou. Compor a estratégia
    // seguinte sobre ele é como uma leitura errada se torna permanente —
    // CLAUDE.md §4, human-in-the-loop.
    expect(where.status).toBe('VALIDATED');
  });

  it('carries the measurement behind the learning, compared but not characterised', async () => {
    const { ctx } = ctxWith([learning()]);

    const result = (await createGetLearningsTool().execute({}, ctx)) as {
      learnings: { source: { comparison: unknown; measured: unknown } }[];
    };

    const source = result.learnings[0]?.source;
    expect(source?.measured).toEqual({ value: 15, unit: '%' });
    // 15 contra baseline 10 e meta 20: +5, +50%, 75% da meta. Números, e nada
    // que chame o experimento de bem ou mal sucedido (experiments.md §14).
    expect(source?.comparison).toEqual({ delta: 5, deltaPct: 50, progressPct: 75 });
    expect(JSON.stringify(result)).not.toMatch(/success|failed|worked/i);
  });

  it('survives a learning written by hand, with no experiment behind it', async () => {
    const { ctx } = ctxWith([learning({ experiment: null })]);

    const result = (await createGetLearningsTool().execute({}, ctx)) as {
      learnings: { source: unknown }[];
    };

    expect(result.learnings[0]?.source).toBeNull();
  });

  it('caps what it asks for, because a prompt has room for the business too', async () => {
    const { ctx, findMany } = ctxWith([]);

    await createGetLearningsTool().execute({}, ctx);

    expect(findMany.mock.calls[0]?.[0]?.take).toBe(20);
    // O mais recente primeiro: com mais história do que cabe, o que o negócio
    // aprendeu por último é o que o descreve melhor hoje.
    expect(findMany.mock.calls[0]?.[0]?.orderBy).toEqual({ createdAt: 'desc' });
  });
});

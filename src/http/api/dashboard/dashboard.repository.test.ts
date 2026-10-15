import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExperimentStatus } from '@prisma/client';
import { createDashboardRepository } from './dashboard.repository.js';
import type { SpineExperiment } from './dashboard.domain.js';

const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';
const NOW = new Date('2026-07-29T12:00:00Z');

const SPINE_ROW = {
  id: 'e1',
  name: 'LinkedIn DM test',
  status: ExperimentStatus.COMPLETED,
  metric: 'replies',
  endDate: null,
  strategyId: 's1',
  _count: { outcomes: 2 },
  learnings: [],
};

function prismaFake(overrides: Record<string, unknown> = {}) {
  return {
    business: { findFirst: vi.fn().mockResolvedValue({ id: 'b1' }) },
    icp: { count: vi.fn().mockResolvedValue(1) },
    goal: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
    agentRun: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([]) },
    strategy: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
    hypothesis: { count: vi.fn().mockResolvedValue(1) },
    experiment: {
      findFirst: vi.fn().mockResolvedValue(SPINE_ROW),
      count: vi.fn().mockResolvedValue(3),
      findMany: vi.fn().mockResolvedValue([]),
    },
    outcome: { findMany: vi.fn().mockResolvedValue([]) },
    learning: { findMany: vi.fn().mockResolvedValue([]) },
    businessContext: {
      findUnique: vi.fn().mockResolvedValue({ currentVersion: { data: { icp: { notes: 'x' }, offer: { notes: 'y' }, market: { notes: 'z' } } } }),
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('snapshot', () => {
  it('reads the setup counts and the spine', async () => {
    const prisma = prismaFake();
    const repo = createDashboardRepository(prisma as never);

    const snapshot = await repo.snapshot(WORKSPACE_ID, NOW);

    expect(snapshot.hasBusiness).toBe(true);
    expect(snapshot.icpCount).toBe(1);
    expect(snapshot.spine).toEqual({
      id: 'e1',
      name: 'LinkedIn DM test',
      status: ExperimentStatus.COMPLETED,
      metric: 'replies',
      endDate: null,
      outcomeCount: 2,
      learnings: [],
      strategyId: 's1',
    });
    expect(snapshot.now).toBe(NOW);
  });

  it('scopes every read to the workspace', async () => {
    const prisma = prismaFake();
    const repo = createDashboardRepository(prisma as never);

    await repo.snapshot(WORKSPACE_ID, NOW);

    // A read that forgets the tenant filter is the one bug in this slice that
    // leaks another customer's data, so it is asserted per call, not in bulk.
    for (const call of [
      prisma.business.findFirst,
      prisma.icp.count,
      prisma.goal.count,
      prisma.agentRun.count,
      prisma.strategy.count,
      prisma.experiment.findFirst,
    ]) {
      expect(call).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: WORKSPACE_ID }) }));
    }
  });

  it('counts only research runs that finished', async () => {
    const prisma = prismaFake();
    const repo = createDashboardRepository(prisma as never);

    await repo.snapshot(WORKSPACE_ID, NOW);

    // Uma pesquisa que falhou não gravou nada no contexto do negócio, então
    // contá-la deixava a home marcando a etapa como feita e escondendo o erro
    // atrás de um check verde.
    expect(prisma.agentRun.count).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, taskType: 'research-growth-context', status: 'COMPLETED' },
    });
  });

  it('picks the latest non-cancelled experiment, newest first, id breaking ties', async () => {
    const prisma = prismaFake();
    const repo = createDashboardRepository(prisma as never);

    await repo.snapshot(WORKSPACE_ID, NOW);

    expect(prisma.experiment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: WORKSPACE_ID, status: { not: ExperimentStatus.CANCELLED } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('reports a null spine for a workspace with no experiments', async () => {
    const prisma = prismaFake({
      experiment: { findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    });
    const repo = createDashboardRepository(prisma as never);

    expect((await repo.snapshot(WORKSPACE_ID, NOW)).spine).toBeNull();
  });

  it('counts the three steps the guide added', async () => {
    const prisma = prismaFake();
    const repo = createDashboardRepository(prisma as never);

    await repo.snapshot(WORKSPACE_ID, NOW);

    expect(prisma.hypothesis.count).toHaveBeenCalledWith({ where: { workspaceId: WORKSPACE_ID } });
    expect(prisma.experiment.count).toHaveBeenCalledWith({ where: { workspaceId: WORKSPACE_ID } });
    expect(prisma.businessContext.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: 'b1' } }),
    );
  });
});

describe('loopContext', () => {
  const SPINE: SpineExperiment = {
    id: 'e1',
    name: 'LinkedIn DM test',
    status: ExperimentStatus.RUNNING,
    metric: 'replies',
    endDate: null,
    outcomeCount: 0,
    learnings: [],
    strategyId: 's1',
  };

  it('numbers the loop by the count of non-cancelled experiments, and resolves the spine strategy by its strategyId', async () => {
    const strategyFindFirst = vi.fn().mockResolvedValue({ id: 's1', name: 'founder-led outbound' });
    const prisma = prismaFake({
      strategy: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([]), findFirst: strategyFindFirst },
      goal: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue({ id: 'g1', name: '30 trials', metric: 'signups', targetValue: 30, unit: 'signups' }),
      },
    });
    const repo = createDashboardRepository(prisma as never);

    const context = await repo.loopContext(WORKSPACE_ID, SPINE);

    expect(context.number).toBe(3);
    expect(context.strategy).toEqual({ id: 's1', name: 'founder-led outbound' });
    expect(context.goal?.id).toBe('g1');
    expect(prisma.experiment.count).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, status: { not: ExperimentStatus.CANCELLED } },
    });
    // With a spine, the strategy is read straight off it — no re-query of the
    // experiment row for the strategyId it already carries.
    expect(strategyFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1', workspaceId: WORKSPACE_ID } }),
    );
    expect(prisma.experiment.findFirst).not.toHaveBeenCalled();
  });

  it('scopes every read to the workspace', async () => {
    const prisma = prismaFake({
      strategy: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue({ id: 's1', name: 'founder-led outbound' }),
      },
      goal: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue({ id: 'g1', name: '30 trials', metric: 'signups', targetValue: 30, unit: 'signups' }),
      },
    });
    const repo = createDashboardRepository(prisma as never);

    await repo.loopContext(WORKSPACE_ID, SPINE);

    for (const call of [prisma.experiment.count, prisma.strategy.findFirst, prisma.goal.findFirst]) {
      expect(call).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: WORKSPACE_ID }) }));
    }
  });

  it('numbers the first loop 1 when no experiment exists yet', async () => {
    const prisma = prismaFake({
      experiment: { findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
      strategy: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue({ id: 's1', name: 'founder-led outbound' }),
      },
    });
    const repo = createDashboardRepository(prisma as never);

    // Spec §3.1: the loop being set up is loop 1, not loop 0.
    expect((await repo.loopContext(WORKSPACE_ID, null)).number).toBe(1);
  });

  it('falls back to the latest non-archived strategy and the latest ACTIVE goal when there is no spine', async () => {
    const strategyFindFirst = vi.fn().mockResolvedValue({ id: 's9', name: 'newest' });
    const goalFindFirst = vi.fn().mockResolvedValue({ id: 'g-active', name: 'Active goal', metric: 'signups', targetValue: 30, unit: 'signups' });
    const prisma = prismaFake({
      experiment: { findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
      strategy: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([]), findFirst: strategyFindFirst },
      goal: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([]), findFirst: goalFindFirst },
    });
    const repo = createDashboardRepository(prisma as never);

    const context = await repo.loopContext(WORKSPACE_ID, null);

    expect(strategyFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: WORKSPACE_ID, status: { not: 'ARCHIVED' } },
        orderBy: { createdAt: 'desc' },
      }),
    );
    // Regression guard: goal resolution must key off whether a *spine*
    // exists, not off whether a strategy happened to resolve. Without a
    // spine — even though a strategy resolved via the fallback above — the
    // strategy's linked goals must never be consulted; it's ACTIVE-goal only.
    expect(goalFindFirst).toHaveBeenCalledTimes(1);
    expect(goalFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: WORKSPACE_ID, status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } }),
    );
    expect(goalFindFirst).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ strategies: expect.anything() }) }),
    );
    expect(context.goal).toEqual({ id: 'g-active', name: 'Active goal', metric: 'signups', targetValue: 30, unit: 'signups' });
  });
});

describe('recentSources', () => {
  it('takes eight of each, newest first, scoped to the workspace', async () => {
    const prisma = prismaFake();
    const repo = createDashboardRepository(prisma as never);

    await repo.recentSources(WORKSPACE_ID);

    for (const call of [
      prisma.goal.findMany,
      prisma.strategy.findMany,
      prisma.experiment.findMany,
      prisma.outcome.findMany,
      prisma.learning.findMany,
      prisma.agentRun.findMany,
    ]) {
      expect(call).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 8,
          where: expect.objectContaining({ workspaceId: WORKSPACE_ID }),
        }),
      );
    }
  });

  it('reads only completed research runs for the feed', async () => {
    const prisma = prismaFake();
    const repo = createDashboardRepository(prisma as never);

    await repo.recentSources(WORKSPACE_ID);

    expect(prisma.agentRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: WORKSPACE_ID, taskType: 'research-growth-context', status: 'COMPLETED' },
      }),
    );
  });
});

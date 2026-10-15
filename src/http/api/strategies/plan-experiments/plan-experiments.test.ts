import { describe, expect, it, vi } from 'vitest';
import { createPlanExperimentsService } from './plan-experiments.service.js';

const STRATEGY_ID = '33333333-3333-3333-3333-333333333333';
const H1 = '44444444-4444-4444-4444-444444444444';
const H2 = '55555555-5555-5555-5555-555555555555';
const TENANT = { workspaceId: 'ws-1', userId: 'u-1', organizationId: 'org-1', role: 'OWNER' as const };

const buildDeps = (over: Record<string, unknown> = {}) => ({
  repo: {
    findStrategyById: vi.fn().mockResolvedValue({ id: STRATEGY_ID }),
    findPlannableHypotheses: vi.fn().mockResolvedValue([{ id: H1 }, { id: H2 }]),
  },
  startRun: vi.fn().mockImplementation(async ({ input }: { input: { hypothesisId: string } }) => ({
    id: `run-${input.hypothesisId}`,
  })),
  ...over,
});

describe('createPlanExperimentsService', () => {
  it('dispara um run propose-experiment por hipótese pendente', async () => {
    const deps = buildDeps();
    const service = createPlanExperimentsService(deps as never);

    const result = await service({ strategyId: STRATEGY_ID, tenant: TENANT });

    expect(deps.startRun).toHaveBeenCalledTimes(2);
    expect(deps.startRun).toHaveBeenCalledWith({ tenant: TENANT, taskType: 'propose-experiment', input: { hypothesisId: H1 } });
    expect(result.runs).toEqual([
      { hypothesisId: H1, agentRunId: `run-${H1}` },
      { hypothesisId: H2, agentRunId: `run-${H2}` },
    ]);
    expect(result.failed).toEqual([]);
  });

  it('uma hipótese que falha não impede as outras', async () => {
    const deps = buildDeps({
      startRun: vi.fn().mockImplementation(async ({ input }: { input: { hypothesisId: string } }) => {
        if (input.hypothesisId === H1) throw new Error('Not enough credits');
        return { id: `run-${input.hypothesisId}` };
      }),
    });
    const service = createPlanExperimentsService(deps as never);

    const result = await service({ strategyId: STRATEGY_ID, tenant: TENANT });

    expect(result.runs).toEqual([{ hypothesisId: H2, agentRunId: `run-${H2}` }]);
    expect(result.failed).toEqual([{ hypothesisId: H1, reason: 'Not enough credits' }]);
  });

  it('não dispara nada quando nenhuma hipótese está pendente', async () => {
    const deps = buildDeps({
      repo: { findStrategyById: vi.fn().mockResolvedValue({ id: STRATEGY_ID }), findPlannableHypotheses: vi.fn().mockResolvedValue([]) },
    });
    const service = createPlanExperimentsService(deps as never);

    const result = await service({ strategyId: STRATEGY_ID, tenant: TENANT });

    expect(result).toEqual({ runs: [], failed: [] });
    expect(deps.startRun).not.toHaveBeenCalled();
  });

  it('trata estratégia de outro workspace como inexistente', async () => {
    const deps = buildDeps({
      repo: { findStrategyById: vi.fn().mockResolvedValue(null), findPlannableHypotheses: vi.fn() },
    });
    const service = createPlanExperimentsService(deps as never);

    await expect(service({ strategyId: STRATEGY_ID, tenant: TENANT })).rejects.toThrow(/not found/i);
    expect(deps.startRun).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createGetExperimentResultTool } from './get-experiment-result.js';

const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';
const EXPERIMENT_ID = '11111111-1111-1111-1111-111111111111';

const EXPERIMENT = {
  id: EXPERIMENT_ID,
  name: 'LinkedIn DM test',
  objective: 'book discovery calls',
  channel: 'linkedin',
  audience: 'seed-stage founders',
  metric: 'replies',
  baselineValue: 4,
  targetValue: 25,
  successCriteria: 'replies >= 25 over 30 days',
  startDate: new Date('2026-07-01T00:00:00Z'),
  endDate: new Date('2026-07-31T00:00:00Z'),
  status: 'COMPLETED',
  hypothesis: {
    statement: 'a personal DM referencing the funding round beats cold email',
    expectedOutcome: 'reply rate above 20%',
    targetMetric: 'replies',
  },
  strategy: { name: 'founder-led outbound', goals: [] },
  outcomes: [
    { metric: 'replies', value: 18, unit: 'replies', observedAt: new Date('2026-07-30T00:00:00Z'), source: 'USER' },
  ],
};

function ctx(findFirst: ReturnType<typeof vi.fn>) {
  return {
    tenant: { userId: 'u1', organizationId: 'org-1', workspaceId: WORKSPACE_ID, role: 'MEMBER' as const },
    prisma: { experiment: { findFirst } } as never,
    signal: new AbortController().signal,
  };
}

describe('get_experiment_result', () => {
  it('takes no arguments from the model', () => {
    const tool = createGetExperimentResultTool(EXPERIMENT_ID);
    // The id is closed over from the run's input. A tool that accepted an id
    // would let injected context read another workspace's experiment.
    expect(tool.argsSchema.safeParse({}).success).toBe(true);
    expect(tool.name).toBe('get_experiment_result');
  });

  it('reads the experiment scoped to the workspace', async () => {
    const findFirst = vi.fn().mockResolvedValue(EXPERIMENT);
    const tool = createGetExperimentResultTool(EXPERIMENT_ID);

    await tool.execute({}, ctx(findFirst));

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: EXPERIMENT_ID, workspaceId: WORKSPACE_ID } }),
    );
  });

  it('returns the measurement contract, the hypothesis and every outcome', async () => {
    const tool = createGetExperimentResultTool(EXPERIMENT_ID);

    const result = (await tool.execute({}, ctx(vi.fn().mockResolvedValue(EXPERIMENT)))) as Record<string, unknown>;

    expect(result).toMatchObject({
      experiment: {
        name: 'LinkedIn DM test',
        metric: 'replies',
        baselineValue: 4,
        targetValue: 25,
        successCriteria: 'replies >= 25 over 30 days',
      },
      hypothesis: { statement: 'a personal DM referencing the funding round beats cold email' },
      strategy: { name: 'founder-led outbound' },
      goal: null,
      outcomes: [{ metric: 'replies', value: 18, unit: 'replies' }],
    });
  });

  it('refuses an experiment in another workspace', async () => {
    const tool = createGetExperimentResultTool(EXPERIMENT_ID);

    const result = await tool.execute({}, ctx(vi.fn().mockResolvedValue(null)));

    expect(result).toEqual({ error: 'experiment not found in this workspace' });
  });
});

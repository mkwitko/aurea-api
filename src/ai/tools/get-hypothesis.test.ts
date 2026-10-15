import { describe, expect, it, vi } from 'vitest';
import { createGetHypothesisTool } from './get-hypothesis.js';

const TENANT = { userId: 'u1', organizationId: 'org-1', workspaceId: 'w1', role: 'MEMBER' as const };

function ctx(hypothesis: unknown) {
  const findFirst = vi.fn().mockResolvedValue(hypothesis);
  return {
    findFirst,
    context: {
      tenant: TENANT,
      prisma: { hypothesis: { findFirst } } as never,
      signal: new AbortController().signal,
    },
  };
}

const HYPOTHESIS = {
  statement: 'Personalizing by funding round lifts reply rate',
  rationale: 'Series A teams answer specifics',
  expectedOutcome: 'reply rate from 4% to 7%',
  targetMetric: 'reply rate',
  confidence: 'MEDIUM',
  strategy: { name: 'Outbound to Series A', objective: 'Book 20 demos', growthMechanism: 'outbound' },
};

describe('get_hypothesis', () => {
  it('takes no arguments from the model', () => {
    expect(createGetHypothesisTool('h1').name).toBe('get_hypothesis');
  });

  it('scopes the read to the workspace and the captured id', async () => {
    const { findFirst, context } = ctx(HYPOTHESIS);
    await createGetHypothesisTool('h1').execute({}, context);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'h1', workspaceId: 'w1' } }),
    );
  });

  it('returns the hypothesis with the strategy it belongs to', async () => {
    // An experiment drafted without the strategy tests the sentence and not
    // the plan behind it.
    const { context } = ctx(HYPOTHESIS);
    await expect(createGetHypothesisTool('h1').execute({}, context)).resolves.toMatchObject({
      hypothesis: { statement: HYPOTHESIS.statement },
      strategy: { name: 'Outbound to Series A' },
    });
  });

  it('reports a miss instead of throwing', async () => {
    const { context } = ctx(null);
    await expect(createGetHypothesisTool('h1').execute({}, context)).resolves.toMatchObject({
      error: expect.stringMatching(/not found/i),
    });
  });
});

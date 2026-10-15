import { describe, expect, it, vi } from 'vitest';
import { proposeHypothesisAgent } from './propose-hypothesis.js';
import { NotFoundError, StrategyNotSelectedError } from '../../../lib/errors.js';

const TENANT = { userId: 'u1', organizationId: 'org-1', workspaceId: 'w1', role: 'MEMBER' as const };
const INPUT = { strategyId: '33333333-3333-3333-3333-333333333333' };

function deps(strategy: unknown) {
  const findFirst = vi.fn().mockResolvedValue(strategy);
  return { findFirst, deps: { prisma: { strategy: { findFirst } } as never, tenant: TENANT } };
}

const OK = {
  filled: {
    statement: 'Personalizing outreach by funding round lifts reply rate',
    rationale: 'Series A teams answer specifics, and the strategy targets them',
    expectedOutcome: 'reply rate rises from 4% to 7%',
    targetMetric: 'reply rate',
    confidence: 'MEDIUM',
  },
  questions: [],
  confidence: 'MEDIUM',
};

describe('propose-hypothesis output', () => {
  const schema = proposeHypothesisAgent.outputSchema;

  it('accepts a hypothesis draft', () => {
    expect(schema.safeParse(OK).success).toBe(true);
  });

  it('rejects VERIFIED on the drafted confidence', () => {
    // The Prisma enum offers it; a hypothesis nobody has tested has not
    // verified anything.
    expect(schema.safeParse({ ...OK, filled: { ...OK.filled, confidence: 'VERIFIED' } }).success).toBe(false);
  });

  it('rejects a strategyId in filled — it comes from the run input', () => {
    expect(schema.safeParse({ ...OK, filled: { ...OK.filled, strategyId: 'other' } }).success).toBe(false);
  });
});

describe('propose-hypothesis tools', () => {
  it('reads the chosen strategy and what past tests taught', () => {
    expect(proposeHypothesisAgent.buildTools(INPUT).map((tool) => tool.name)).toEqual([
      'get_strategy',
      'get_learnings',
    ]);
  });
});

describe('propose-hypothesis precheck', () => {
  it('passes for an approved strategy', async () => {
    const { deps: d } = deps({ status: 'APPROVED' });
    await expect(proposeHypothesisAgent.precheck!(INPUT, d)).resolves.toBeUndefined();
  });

  it('passes for an active strategy', async () => {
    const { deps: d } = deps({ status: 'ACTIVE' });
    await expect(proposeHypothesisAgent.precheck!(INPUT, d)).resolves.toBeUndefined();
  });

  it('refuses a strategy the founder has not committed to', async () => {
    // DRAFT, PROPOSED, PAUSED and ARCHIVED all mean the same thing here: no
    // one has said "this is the plan", so a hypothesis under it tests nothing.
    for (const status of ['DRAFT', 'PROPOSED', 'PAUSED', 'ARCHIVED']) {
      const { deps: d } = deps({ status });
      await expect(proposeHypothesisAgent.precheck!(INPUT, d)).rejects.toBeInstanceOf(StrategyNotSelectedError);
    }
  });

  it('refuses a strategy in another workspace as not found', async () => {
    const { deps: d } = deps(null);
    await expect(proposeHypothesisAgent.precheck!(INPUT, d)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('scopes its lookup to the workspace', async () => {
    const { findFirst, deps: d } = deps({ status: 'ACTIVE' });
    await proposeHypothesisAgent.precheck!(INPUT, d);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: INPUT.strategyId, workspaceId: 'w1' } }),
    );
  });
});

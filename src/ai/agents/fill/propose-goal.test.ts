import { describe, expect, it, vi } from 'vitest';
import { proposeGoalAgent } from './propose-goal.js';
import { NoActiveIcpError, NotFoundError } from '../../../lib/errors.js';

const TENANT = { userId: 'u1', organizationId: 'org-1', workspaceId: 'w1', role: 'MEMBER' as const };
const INPUT = {
  businessId: '11111111-1111-1111-1111-111111111111',
  icpId: '22222222-2222-2222-2222-222222222222',
};

function deps(business: unknown, icp: unknown) {
  const businessFindFirst = vi.fn().mockResolvedValue(business);
  const icpFindFirst = vi.fn().mockResolvedValue(icp);
  return {
    icpFindFirst,
    deps: {
      prisma: { business: { findFirst: businessFindFirst }, icp: { findFirst: icpFindFirst } } as never,
      tenant: TENANT,
    },
  };
}

const QUESTION = {
  id: 'target',
  ask: 'Onde você quer chegar com esse número em três meses?',
  why: 'É a ambição que a AUREA vai testar contra a realidade.',
  answerType: 'number',
  fills: 'targetValue',
  impact: 3,
};

const OK = {
  filled: {
    name: 'Triple qualified demos',
    description: 'Move the pipeline number the whole quarter depends on',
    metric: 'qualified demos per month',
    unit: 'demos',
    baselineValue: 12,
    priority: 'HIGH',
  },
  questions: [QUESTION],
  confidence: 'MEDIUM',
};

describe('propose-goal output', () => {
  const schema = proposeGoalAgent.outputSchema;

  it('accepts a goal draft that asks for the ambition', () => {
    expect(schema.safeParse(OK).success).toBe(true);
  });

  it('rejects a filled targetValue or deadline', () => {
    // Where the founder wants to get to, and by when, is the founder's call.
    // A model that fills them is inventing the ambition it is meant to serve.
    expect(schema.safeParse({ ...OK, filled: { ...OK.filled, targetValue: 40 } }).success).toBe(false);
    expect(
      schema.safeParse({ ...OK, filled: { ...OK.filled, deadline: '2026-10-01T00:00:00.000Z' } }).success,
    ).toBe(false);
  });

  it('allows asking for the deadline', () => {
    expect(
      schema.safeParse({ ...OK, questions: [{ ...QUESTION, id: 'deadline', fills: 'deadline', answerType: 'text' }] })
        .success,
    ).toBe(true);
  });

  it('rejects a question about the metric it already filled', () => {
    expect(
      schema.safeParse({ ...OK, questions: [{ ...QUESTION, id: 'm', fills: 'metric', answerType: 'text' }] }).success,
    ).toBe(false);
  });
});

describe('propose-goal precheck', () => {
  it('passes for an active ICP in this workspace', async () => {
    const { deps: d } = deps({ id: INPUT.businessId }, { id: INPUT.icpId, status: 'ACTIVE' });
    await expect(proposeGoalAgent.precheck!(INPUT, d)).resolves.toBeUndefined();
  });

  it('refuses an archived ICP', async () => {
    const { deps: d } = deps({ id: INPUT.businessId }, null);
    await expect(proposeGoalAgent.precheck!(INPUT, d)).rejects.toBeInstanceOf(NoActiveIcpError);
  });

  it('refuses a business in another workspace', async () => {
    const { deps: d } = deps(null, { id: INPUT.icpId, status: 'ACTIVE' });
    await expect(proposeGoalAgent.precheck!(INPUT, d)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('scopes the ICP lookup to the workspace and to ACTIVE', async () => {
    const { icpFindFirst, deps: d } = deps({ id: INPUT.businessId }, { id: INPUT.icpId, status: 'ACTIVE' });
    await proposeGoalAgent.precheck!(INPUT, d);
    expect(icpFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: INPUT.icpId, workspaceId: 'w1', status: 'ACTIVE', deletedAt: null },
      }),
    );
  });
});

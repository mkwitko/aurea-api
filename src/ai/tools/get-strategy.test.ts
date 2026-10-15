import { describe, expect, it, vi } from 'vitest';
import { createGetStrategyTool } from './get-strategy.js';

const TENANT = { userId: 'u1', organizationId: 'org-1', workspaceId: 'w1', role: 'MEMBER' as const };

function ctx(strategy: unknown) {
  const findFirst = vi.fn().mockResolvedValue(strategy);
  return {
    findFirst,
    context: {
      tenant: TENANT,
      prisma: { strategy: { findFirst } } as never,
      signal: new AbortController().signal,
    },
  };
}

const STRATEGY = {
  name: 'Outbound to Series A',
  description: 'Direct outreach to funded SaaS founders',
  objective: 'Book 20 demos',
  strategicThesis: 'Series A teams are underserved by generic outreach',
  growthMechanism: 'outbound',
  expectedOutcome: '20 demos booked in 60 days',
  channels: ['email', 'linkedin'],
  assumptions: ['founders check email daily'],
  evidence: ['prior campaign got 3% reply rate'],
  risks: ['deliverability'],
};

describe('get_strategy', () => {
  it('takes no arguments from the model', () => {
    // The id comes from the run input. Injected content must not be able to
    // ask for another workspace's strategy.
    const tool = createGetStrategyTool('strat-1');
    expect(tool.argsSchema.safeParse({ strategyId: 'someone-elses' }).success).toBe(true);
    expect(tool.name).toBe('get_strategy');
  });

  it('scopes the read to the workspace and the captured id', async () => {
    const { findFirst, context } = ctx(STRATEGY);
    await createGetStrategyTool('strat-1').execute({}, context);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'strat-1', workspaceId: 'w1' } }),
    );
  });

  it('returns the strategy', async () => {
    const { context } = ctx(STRATEGY);
    await expect(createGetStrategyTool('strat-1').execute({}, context)).resolves.toMatchObject({
      strategy: { name: STRATEGY.name },
    });
  });

  it('reports a miss instead of throwing', async () => {
    // A thrown error would kill the run; a reported miss lets the model say it
    // could not read the strategy and return an honest empty proposal.
    const { context } = ctx(null);
    await expect(createGetStrategyTool('strat-1').execute({}, context)).resolves.toMatchObject({
      error: expect.stringMatching(/not found/i),
    });
  });
});

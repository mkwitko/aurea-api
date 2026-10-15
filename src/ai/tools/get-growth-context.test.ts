import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createGetGrowthContextTool } from './get-growth-context.js';
import type { ToolContext } from './tool.js';

const tenant = { userId: 'u1', organizationId: 'o1', workspaceId: 'ws-1', role: 'OWNER' as const };

const GOAL = { id: 'goal-1', name: 'Ten discovery calls', metric: 'discovery_calls_booked', targetValue: 10, baselineValue: 2, deadline: null, status: 'ACTIVE' };
const BUSINESS = { id: 'biz-1', name: 'Acme' };

function ctx(over: { goal?: unknown } = {}): ToolContext {
  return {
    tenant,
    prisma: {
      goal: { findFirst: vi.fn().mockResolvedValue('goal' in over ? over.goal : GOAL) },
      business: { findFirst: vi.fn().mockResolvedValue(BUSINESS) },
      businessContext: { findUnique: vi.fn().mockResolvedValue({ currentVersion: { data: { company: { name: 'Acme' } } } }) },
      icp: { findMany: vi.fn().mockResolvedValue([{ id: 'icp-1', name: 'Ops leads' }]) },
    } as unknown as PrismaClient,
    signal: new AbortController().signal,
  };
}

describe('get_growth_context tool', () => {
  it('returns the goal, the ICPs and the business context in one call', async () => {
    // One call, not three: a model that must chain three reads before
    // answering will sometimes make two.
    const tool = createGetGrowthContextTool('goal-1');

    const result = await tool.execute({}, ctx());

    expect(result).toMatchObject({
      goal: { name: 'Ten discovery calls' },
      businessName: 'Acme',
      icps: [{ name: 'Ops leads' }],
    });
  });

  it('scopes every read to the tenant workspace', async () => {
    const tool = createGetGrowthContextTool('goal-1');
    const context = ctx();

    await tool.execute({}, context);

    expect(context.prisma.goal.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'goal-1', workspaceId: 'ws-1' }) }),
    );
    expect(context.prisma.icp.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ workspaceId: 'ws-1' }) }),
    );
  });

  it('reports a goal outside the workspace instead of throwing', async () => {
    // The runner feeds tool results back to the model; an exception would kill
    // the run where a message lets the model say it cannot answer.
    const tool = createGetGrowthContextTool('goal-1');

    expect(await tool.execute({}, ctx({ goal: null }))).toEqual({ error: 'goal not found in this workspace' });
  });

  it('ignores a goal id supplied in the model arguments', async () => {
    // The id is bound at buildTools time from the run input. Content injected
    // into the context must not be able to ask for another goal.
    const tool = createGetGrowthContextTool('goal-1');
    const context = ctx();

    await tool.execute({ goalId: 'goal-999' } as never, context);

    expect(context.prisma.goal.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'goal-1' }) }),
    );
  });
});

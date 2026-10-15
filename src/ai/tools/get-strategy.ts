import { z } from 'zod';
import type { Tool, ToolContext } from './tool.js';

const argsSchema = z.object({});

type Args = z.infer<typeof argsSchema>;

export function createGetStrategyTool(strategyId: string): Tool<Args> {
  return {
    name: 'get_strategy',
    description:
      'Returns the strategy the founder chose: its thesis, its growth mechanism, the channels it uses, and the assumptions, evidence and risks recorded with it. Call this before answering.',
    argsSchema,
    async execute(_args: Args, ctx: ToolContext) {
      const strategy = await ctx.prisma.strategy.findFirst({
        where: { id: strategyId, workspaceId: ctx.tenant.workspaceId },
        select: {
          name: true,
          description: true,
          objective: true,
          strategicThesis: true,
          growthMechanism: true,
          expectedOutcome: true,
          channels: true,
          assumptions: true,
          evidence: true,
          risks: true,
        },
      });
      if (!strategy) return { error: 'strategy not found in this workspace' };
      return { strategy };
    },
  };
}

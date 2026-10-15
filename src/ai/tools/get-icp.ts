import { z } from 'zod';
import type { Tool, ToolContext } from './tool.js';

// Sem argumentos: o ICP vem do input do run, nunca do modelo — mesma regra do
// get_experiment_result e do get_growth_context.
const argsSchema = z.object({});

type Args = z.infer<typeof argsSchema>;

export function createGetIcpTool(icpId: string): Tool<Args> {
  return {
    name: 'get_icp',
    description:
      'Returns the ICP under analysis: who they are, what hurts, what they want, what triggers a purchase and what they object to. Call this before answering.',
    argsSchema,
    async execute(_args: Args, ctx: ToolContext) {
      const icp = await ctx.prisma.icp.findFirst({
        where: { id: icpId, workspaceId: ctx.tenant.workspaceId, deletedAt: null },
        select: {
          name: true,
          description: true,
          characteristics: true,
          painPoints: true,
          customerGoals: true,
          buyingTriggers: true,
          objections: true,
        },
      });
      if (!icp) return { error: 'icp not found in this workspace' };
      return { icp };
    },
  };
}

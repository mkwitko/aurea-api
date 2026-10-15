import { z } from 'zod';
import type { Tool, ToolContext } from './tool.js';

const argsSchema = z.object({
  sections: z
    .array(z.string())
    .optional()
    .describe('Optional list of business-context section keys. Omit to get everything.'),
});

type Args = z.infer<typeof argsSchema>;

// O goalId vem do input do run, nunca dos argumentos do modelo: conteúdo
// injetado no contexto não pode pedir o goal de outro workspace.
export function createGetGrowthContextTool(goalId: string): Tool<Args> {
  return {
    name: 'get_growth_context',
    description:
      'Returns the goal under analysis, the workspace ICPs and the stored business context. Call this before answering.',
    argsSchema,
    async execute(args: Args, ctx: ToolContext) {
      const goal = await ctx.prisma.goal.findFirst({
        where: { id: goalId, workspaceId: ctx.tenant.workspaceId },
      });
      if (!goal) return { error: 'goal not found in this workspace' };

      // Um business por workspace é escopo de MVP (mvp.md §5), então o
      // business é resolvido pelo tenant e não pelo input.
      const business = await ctx.prisma.business.findFirst({
        where: { workspaceId: ctx.tenant.workspaceId, deletedAt: null },
      });

      const context = business
        ? await ctx.prisma.businessContext.findUnique({
            where: { businessId: business.id },
            include: { currentVersion: true },
          })
        : null;

      // Narrowing of a Prisma JSON column, not unvalidated external input
      const data = (context?.currentVersion?.data ?? {}) as Record<string, unknown>;
      const sections = args.sections?.length
        ? Object.fromEntries(Object.entries(data).filter(([key]) => args.sections?.includes(key)))
        : data;

      const icps = await ctx.prisma.icp.findMany({
        where: { workspaceId: ctx.tenant.workspaceId, deletedAt: null },
      });

      return {
        goal: {
          name: goal.name,
          metric: goal.metric,
          baselineValue: goal.baselineValue,
          targetValue: goal.targetValue,
          deadline: goal.deadline,
          status: goal.status,
        },
        businessName: business?.name ?? null,
        context: sections,
        icps: icps.map((icp) => ({ id: icp.id, name: icp.name, description: icp.description })),
      };
    },
  };
}

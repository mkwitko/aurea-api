import { z } from 'zod';
import type { Tool, ToolContext } from './tool.js';

const argsSchema = z.object({});

type Args = z.infer<typeof argsSchema>;

export function createGetHypothesisTool(hypothesisId: string): Tool<Args> {
  return {
    name: 'get_hypothesis',
    description:
      'Returns the hypothesis under test and the strategy it belongs to. Call this before answering.',
    argsSchema,
    async execute(_args: Args, ctx: ToolContext) {
      const hypothesis = await ctx.prisma.hypothesis.findFirst({
        where: { id: hypothesisId, workspaceId: ctx.tenant.workspaceId },
        select: {
          statement: true,
          rationale: true,
          expectedOutcome: true,
          targetMetric: true,
          confidence: true,
          // Um experimento desenhado sem a estratégia testa a frase e não o
          // plano por trás dela.
          strategy: { select: { name: true, objective: true, growthMechanism: true } },
        },
      });
      if (!hypothesis) return { error: 'hypothesis not found in this workspace' };

      const { strategy, ...rest } = hypothesis;
      return { hypothesis: rest, strategy };
    },
  };
}

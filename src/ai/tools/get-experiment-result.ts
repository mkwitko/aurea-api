import { z } from 'zod';
import type { Tool, ToolContext } from './tool.js';
import { compareMeasurement } from '../../http/api/outcomes/outcomes.domain.js';

// Sem argumentos: o experimento vem do input do run, nunca do modelo. Conteúdo
// injetado no contexto não pode pedir o experimento de outro workspace — mesma
// regra do get_growth_context.
const argsSchema = z.object({});

type Args = z.infer<typeof argsSchema>;

export function createGetExperimentResultTool(experimentId: string): Tool<Args> {
  return {
    name: 'get_experiment_result',
    description:
      'Returns the experiment under analysis: its metric, baseline, target and success criteria, the hypothesis it tests, its strategy and goal, and every outcome recorded against it. Each outcome carries a precomputed comparison (delta and deltaPct against the baseline, progressPct against the target) — use those numbers, do not recompute them. Call this before answering.',
    argsSchema,
    async execute(_args: Args, ctx: ToolContext) {
      const experiment = await ctx.prisma.experiment.findFirst({
        where: { id: experimentId, workspaceId: ctx.tenant.workspaceId },
        include: {
          hypothesis: { select: { statement: true, expectedOutcome: true, targetMetric: true } },
          strategy: { select: { name: true, goals: { select: { goal: { select: { name: true, metric: true, targetValue: true, unit: true } } } } } },
          outcomes: {
            orderBy: { observedAt: 'asc' },
            select: { metric: true, value: true, unit: true, observedAt: true, source: true },
          },
        },
      });
      if (!experiment) return { error: 'experiment not found in this workspace' };

      return {
        experiment: {
          name: experiment.name,
          objective: experiment.objective,
          channel: experiment.channel,
          audience: experiment.audience,
          metric: experiment.metric,
          baselineValue: experiment.baselineValue,
          targetValue: experiment.targetValue,
          // Passado ao modelo de propósito: ele pode raciocinar sobre o critério
          // em prosa, e não tem onde registrar um veredito (spec §3.1).
          successCriteria: experiment.successCriteria,
          startDate: experiment.startDate,
          endDate: experiment.endDate,
        },
        hypothesis: experiment.hypothesis,
        strategy: { name: experiment.strategy.name },
        goal: experiment.strategy.goals[0]?.goal ?? null,
        // A comparação vem calculada para o modelo não fazer a aritmética — um
        // delta errado viraria um aprendizado errado. Continuam sendo números:
        // nada aqui caracteriza o experimento (experiments.md §14).
        outcomes: experiment.outcomes.map((outcome) => ({
          ...outcome,
          comparison: compareMeasurement({
            baselineValue: experiment.baselineValue,
            targetValue: experiment.targetValue,
            value: outcome.value,
          }),
        })),
      };
    },
  };
}

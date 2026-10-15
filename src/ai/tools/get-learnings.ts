import { z } from 'zod';
import type { Tool, ToolContext } from './tool.js';
import { compareMeasurement } from '../../http/api/outcomes/outcomes.domain.js';

// Sem argumentos: o workspace vem do tenant do run, nunca do modelo — mesma
// regra do get_growth_context e do get_experiment_result.
const argsSchema = z.object({});

type Args = z.infer<typeof argsSchema>;

/** O que cabe num prompt sem empurrar o contexto do negócio para fora dele. */
const MAX_LEARNINGS = 20;

/**
 * O que este workspace já aprendeu — a metade do ciclo que faltava.
 *
 * Sem esta tool os agentes de proposta só veem o presente (meta, contexto,
 * ICPs) e propõem a mesma coisa na décima volta que na primeira. O aprendizado
 * chega com a medição que o originou, para o modelo pesar evidência e não só
 * uma frase.
 *
 * Só VALIDATED. Um CANDIDATE é rascunho que o fundador ainda não confirmou, e
 * compor a estratégia seguinte sobre uma leitura não confirmada é como um erro
 * de interpretação se torna permanente — o oposto do human-in-the-loop do
 * CLAUDE.md §4. O painel já manda validar antes de fechar o ciclo.
 */
export function createGetLearningsTool(): Tool<Args> {
  return {
    name: 'get_learnings',
    description:
      'Returns what this workspace has confirmed from past experiments: each validated learning with the experiment and the measurement behind it. Call this before proposing anything, and do not propose again something a learning already ruled out.',
    argsSchema,
    async execute(_args: Args, ctx: ToolContext) {
      const rows = await ctx.prisma.learning.findMany({
        where: {
          workspaceId: ctx.tenant.workspaceId,
          status: 'VALIDATED',
        },
        // Os mais recentes: quando há mais história do que cabe no prompt, o que
        // o negócio aprendeu por último é o que descreve melhor o negócio hoje.
        orderBy: { createdAt: 'desc' },
        take: MAX_LEARNINGS,
        select: {
          id: true,
          title: true,
          statement: true,
          confidence: true,
          createdAt: true,
          experiment: {
            select: {
              name: true,
              metric: true,
              baselineValue: true,
              targetValue: true,
              outcomes: { orderBy: { observedAt: 'desc' }, take: 1, select: { value: true, unit: true } },
            },
          },
        },
      });

      return {
        learnings: rows.map((row) => {
          const latest = row.experiment?.outcomes[0] ?? null;
          return {
            id: row.id,
            title: row.title,
            statement: row.statement,
            confidence: row.confidence,
            learnedAt: row.createdAt,
            // Um aprendizado sem o número que o gerou é opinião. Números
            // apenas: nada aqui caracteriza o experimento como bem ou mal
            // sucedido (docs/domains/experiments.md §14).
            source: row.experiment
              ? {
                  experiment: row.experiment.name,
                  metric: row.experiment.metric,
                  baselineValue: row.experiment.baselineValue,
                  targetValue: row.experiment.targetValue,
                  measured: latest ? { value: latest.value, unit: latest.unit } : null,
                  comparison: latest
                    ? compareMeasurement({
                        baselineValue: row.experiment.baselineValue,
                        targetValue: row.experiment.targetValue,
                        value: latest.value,
                      })
                    : null,
                }
              : null,
          };
        }),
      };
    },
  };
}

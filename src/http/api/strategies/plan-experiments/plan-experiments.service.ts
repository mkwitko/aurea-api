import { NotFoundError } from '../../../../lib/errors.js';
import { proposeExperimentAgent } from '../../../../ai/agents/fill/propose-experiment.js';
import type { TenantContext } from '../../../../lib/tenant.js';
import type { StrategiesRepository } from '../strategies.repository.js';

export type PlanExperimentsDeps = {
  repo: StrategiesRepository;
  startRun(args: { tenant: TenantContext; taskType: string; input: unknown }): Promise<{ id: string }>;
};

export function createPlanExperimentsService(deps: PlanExperimentsDeps) {
  return async (input: { strategyId: string; tenant: TenantContext }) => {
    const strategy = await deps.repo.findStrategyById(input.tenant.workspaceId, input.strategyId);
    if (!strategy) throw new NotFoundError('Strategy not found');

    const pending = await deps.repo.findPlannableHypotheses(input.tenant.workspaceId, input.strategyId);

    const runs: { hypothesisId: string; agentRunId: string }[] = [];
    const failed: { hypothesisId: string; reason: string }[] = [];

    // Sequencial de propósito: cada `startRun` autoriza crédito, e disparar os
    // nove em paralelo faria nove autorizações correrem sobre o mesmo saldo. O
    // trabalho pesado é do worker — aqui só se enfileira.
    for (const hypothesis of pending) {
      try {
        const run = await deps.startRun({
          tenant: input.tenant,
          taskType: proposeExperimentAgent.taskType,
          input: { hypothesisId: hypothesis.id },
        });
        runs.push({ hypothesisId: hypothesis.id, agentRunId: run.id });
      } catch (error) {
        // Uma recusa numa hipótese — crédito curto, run igual já em voo — não
        // pode derrubar o lote: o que passou fica enfileirado e o que falhou
        // volta nomeado, com retry individual na tela.
        failed.push({ hypothesisId: hypothesis.id, reason: error instanceof Error ? error.message : 'unknown error' });
      }
    }

    return { runs, failed };
  };
}

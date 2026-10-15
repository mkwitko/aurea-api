import { BadRequestError, NotFoundError } from '../../../../lib/errors.js';
import { proposeExperimentAgent } from '../../../../ai/agents/fill/propose-experiment.js';
import type { ExperimentsRepository } from '../experiments.repository.js';

export type FromProposalExperimentDeps = {
  repo: ExperimentsRepository;
  findRun(id: string, workspaceId: string): Promise<{
    taskType: string;
    status: string;
    input: unknown;
    output: unknown;
  } | null>;
};

// Duas abas podem chegar aqui para o mesmo run: a leitura de `findBySourceRun`
// no início só reduz a janela, não fecha a corrida. Se as duas passarem por
// ela antes de qualquer `create`, a segunda escrita esbarra na unique de
// `sourceAgentRunId` — e isso é o mesmo run virando experimento duas vezes,
// não uma falha do servidor. Mesmo padrão de
// `create-from-proposal.service.ts`: só o P2002 desta constraint conta como
// "já existe", e o alvo é checado por substring — o Postgres relata a coluna
// como array (`@@unique` inline) ou como nome de índice
// (`Experiment_sourceAgentRunId_key`), e o nome do índice já contém a coluna
// como substring, então um único predicado cobre as duas formas.
const isSourceRunViolation = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const { code, meta } = error as { code?: string; meta?: { target?: unknown } };
  if (code !== 'P2002') return false;
  const target = meta?.target;
  const text = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return text.includes('sourceAgentRunId');
};

export function createFromProposalExperimentService(deps: FromProposalExperimentDeps) {
  return async (input: { agentRunId: string; workspaceId: string }) => {
    // Antes de qualquer leitura do run: se este run já virou experimento, a
    // resposta é aquele experimento, e nada mais precisa ser decidido.
    const existing = await deps.repo.findBySourceRun(input.workspaceId, input.agentRunId);
    if (existing) return existing;

    const run = await deps.findRun(input.agentRunId, input.workspaceId);
    if (!run) throw new NotFoundError('Agent run not found');

    if (run.taskType !== proposeExperimentAgent.taskType) {
      throw new BadRequestError('This run did not design an experiment');
    }
    if (run.status !== 'COMPLETED') {
      throw new BadRequestError(`This run is ${run.status}, so it has nothing to accept yet`);
    }

    const runInput = proposeExperimentAgent.inputSchema.safeParse(run.input);
    if (!runInput.success) throw new BadRequestError('This run input is not readable');

    const output = proposeExperimentAgent.outputSchema.safeParse(run.output);
    if (!output.success) throw new BadRequestError('This run output is not a readable proposal');

    const filled = output.data.filled;

    // name e metric são NOT NULL no banco e opcionais no schema do agente.
    // Inventar qualquer um dos dois seria fabricar a definição do próprio teste
    // — a tela manda o fundador ao formulário com o resto pré-preenchido.
    if (!filled.name || !filled.metric) {
      throw new BadRequestError('This proposal has no name and metric, so it cannot become an experiment yet');
    }

    // A hipótese vem do input do run, e é relida aqui com escopo de workspace:
    // o run guarda um uuid, não uma prova de que ele ainda pertence a este
    // workspace.
    const hypothesis = await deps.repo.findHypothesis(input.workspaceId, runInput.data.hypothesisId);
    if (!hypothesis) throw new BadRequestError('Hypothesis not found in this workspace');

    // baselineValue, targetValue, startDate e endDate ficam de fora de
    // propósito — spec §2. Nascem nulos e a trava do PLANNED os cobra.
    try {
      return await deps.repo.create(input.workspaceId, {
        hypothesisId: hypothesis.id,
        strategyId: hypothesis.strategyId,
        name: filled.name,
        metric: filled.metric,
        ...(filled.description ? { description: filled.description } : {}),
        ...(filled.objective ? { objective: filled.objective } : {}),
        ...(filled.channel ? { channel: filled.channel } : {}),
        ...(filled.audience ? { audience: filled.audience } : {}),
        ...(filled.successCriteria ? { successCriteria: filled.successCriteria } : {}),
        sourceAgentRunId: input.agentRunId,
      });
    } catch (error) {
      if (isSourceRunViolation(error)) {
        // A outra aba venceu a corrida entre a leitura e esta escrita: a
        // resposta certa é a linha que ela criou, não um 500.
        const raced = await deps.repo.findBySourceRun(input.workspaceId, input.agentRunId);
        if (raced) return raced;
      }
      throw error;
    }
  };
}

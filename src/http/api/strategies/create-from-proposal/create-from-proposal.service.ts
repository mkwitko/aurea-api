import { BadRequestError, NotFoundError } from '../../../../lib/errors.js';
import { proposeStrategiesAgent } from '../../../../ai/agents/propose-strategies.js';
import type { StrategiesRepository } from '../strategies.repository.js';
import type { FromProposalBody } from './create-from-proposal.schema.js';
import { mergeProposedOptions } from './merge-options.js';

export type FromProposalDeps = {
  repo: StrategiesRepository;
  findRun(id: string, workspaceId: string): Promise<{
    taskType: string;
    status: string;
    input: unknown;
    output: unknown;
  } | null>;
};

const runInputSchema = proposeStrategiesAgent.inputSchema;

// Uma violação de unicidade aqui significa que esta opção já foi aceita.
// Traduzir para 400 em vez de deixar vazar como 500: é uma recusa
// previsível, não uma falha do servidor. Checa o alvo da constraint, não só
// o código: P2002 é o código genérico de qualquer violação de unicidade no
// statement, e só as colunas de proveniência significam "já aceita".
//
// O Postgres relata o alvo de duas formas — o array com os nomes das colunas
// (`@@unique` inline) ou o nome do índice (índice nomeado), e o nome do
// índice pode chegar como string solta ou como array de um elemento só.
// Testar `Array.isArray` sozinho, como uma versão anterior fazia, cobria só a
// primeira forma e deixaria a segunda escapar como 500. O nome do índice
// (`Strategy_sourceAgentRunId_sourceOptionIndex_key`) contém as duas colunas
// como substring, então um único predicado por substring cobre as três
// formas sem precisar distingui-las.
const isAlreadyAcceptedViolation = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const { code, meta } = error as { code?: string; meta?: { target?: unknown } };
  if (code !== 'P2002') return false;
  const target = meta?.target;
  const text = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return text.includes('sourceAgentRunId') || text.includes('sourceOptionIndex');
};

export function createFromProposalService(deps: FromProposalDeps) {
  return async (input: FromProposalBody & { workspaceId: string }) => {
    const run = await deps.findRun(input.agentRunId, input.workspaceId);
    if (!run) throw new NotFoundError('Agent run not found');

    if (run.taskType !== proposeStrategiesAgent.taskType) {
      throw new BadRequestError('This run did not propose strategies');
    }
    if (run.status !== 'COMPLETED') {
      throw new BadRequestError(`This run is ${run.status}, so it has nothing to accept yet`);
    }

    const output = proposeStrategiesAgent.outputSchema.safeParse(run.output);
    if (!output.success) throw new BadRequestError('This run output is not a readable proposal');

    // Ordenados e sem repetição: a mesma opção duas vezes na seleção duplicaria
    // as hipóteses dela no plano fundido, e a ordem é a da proposta na tela.
    const indexes = [...new Set(input.optionIndexes)].sort((a, b) => a - b);

    const chosen = indexes.map((index) => {
      const option = output.data.options[index];
      if (!option) throw new BadRequestError('That option is not in this proposal');
      return option;
    });

    const runInput = runInputSchema.safeParse(run.input);
    if (!runInput.success) throw new BadRequestError('This run input is not readable');

    // O input do run só garante que goalId tem forma de uuid, não que o goal
    // existe ou pertence a este workspace: get_growth_context devolve um erro
    // como DATA em vez de lançar, então um run com um goalId inexistente ou
    // de outro workspace ainda chega a COMPLETED com output schema-válido.
    const goalsFound = await deps.repo.countGoals(input.workspaceId, [runInput.data.goalId]);
    if (goalsFound !== 1) throw new BadRequestError("This run's goal is not in this workspace");

    // Uma opção que já entrou num plano — sozinha ou combinada — está gasta. A
    // unicidade do banco só vê o índice primário, então sem esta checagem
    // combinar 0+1 e depois adotar a 1 sozinha criaria duas estratégias dizendo
    // a mesma coisa.
    const used = await deps.repo.usedOptionIndexes(input.workspaceId, input.agentRunId);
    if (indexes.some((index) => used.includes(index))) {
      throw new BadRequestError('That option has already been accepted');
    }

    // Sem `strategy`, o servidor funde as opções ele mesmo: é o aceite "como
    // veio", e nesse caminho o browser não afirma nada sobre o que o agente
    // propôs. Com `strategy`, o texto é o que o fundador editou na tela — já
    // validado pelo schema da rota contra os limites das colunas.
    const draft = input.strategy ?? mergeProposedOptions(chosen);

    try {
      return await deps.repo.createWithHypotheses(
        input.workspaceId,
        {
          name: draft.name,
          strategicThesis: draft.strategicThesis,
          growthMechanism: draft.growthMechanism,
          expectedOutcome: draft.expectedOutcome,
          channels: draft.channels,
          assumptions: draft.assumptions,
          risks: draft.risks,
          // evidence fica vazio de propósito: evidência com proveniência chega
          // na fase 04, e preenchê-la com a lembrança do modelo seria inventá-la.
          // tradeoffs também fica de fora de propósito: Strategy não tem coluna
          // para isso — o trade-off importa na revisão, antes do aceite; depois
          // de aceito, ele já é uma decisão tomada, não um dado a guardar.
        },
        [runInput.data.goalId],
        { agentRunId: input.agentRunId, optionIndexes: indexes },
        draft.hypotheses,
      );
    } catch (error) {
      if (isAlreadyAcceptedViolation(error)) {
        throw new BadRequestError('That option has already been accepted');
      }
      throw error;
    }
  };
}

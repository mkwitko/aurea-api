import { BadRequestError, NotFoundError } from '../../../../lib/errors.js';
import { proposeStrategiesAgent } from '../../../../ai/agents/propose-strategies.js';
import { mergeProposedOptions } from '../create-from-proposal/merge-options.js';

export type ProposalDraftDeps = {
  findRun(id: string, workspaceId: string): Promise<{ taskType: string; status: string; output: unknown } | null>;
};

export function createProposalDraftService(deps: ProposalDraftDeps) {
  return async (input: { agentRunId: string; optionIndexes: number[]; workspaceId: string }) => {
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

    // Mesma normalização do aceite: ordenado, sem repetição. Um rascunho que
    // discordasse do que o aceite grava seria pior que nenhum rascunho.
    const indexes = [...new Set(input.optionIndexes)].sort((a, b) => a - b);
    if (!indexes.length || indexes.length > 3) throw new BadRequestError('Choose one, two or three options');

    const chosen = indexes.map((index) => {
      const option = output.data.options[index];
      if (!option) throw new BadRequestError('That option is not in this proposal');
      return option;
    });

    return { strategy: mergeProposedOptions(chosen) };
  };
}

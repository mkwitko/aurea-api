import type { StrategiesRepository } from '../strategies.repository.js';

export type ProposalUsageDeps = { repo: StrategiesRepository };

export function createProposalUsageService(deps: ProposalUsageDeps) {
  return async (input: { agentRunId: string; workspaceId: string }) => {
    // Sem 404: o recurso é o uso das opções neste workspace, não o run. Um run
    // inexistente, de outro workspace, ou existente e nunca adotado dão a mesma
    // resposta honesta — nenhuma opção gasta aqui.
    const usedOptionIndexes = await deps.repo.usedOptionIndexes(input.workspaceId, input.agentRunId);
    return { usedOptionIndexes };
  };
}

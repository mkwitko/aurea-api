import type { BusinessRepository } from '../business.repository.js';
import { researchPresence } from '../research-context.js';
import { loadResearchOutput, type FindRun } from '../research-run.js';

export type ResearchPresenceDeps = {
  repo: BusinessRepository;
  findRun: FindRun;
};

/**
 * O que desta pesquisa já está guardado. É o que faz a revisão sobreviver a um
 * F5: sem isso a tela só sabia o que ela mesma tinha acabado de salvar, e um
 * recarregamento reabria tudo como se nada tivesse sido guardado.
 *
 * Não é um 404 quando o workspace não tem negócio nem contexto ainda: não ter
 * contexto é a resposta "nada está guardado", que é uma resposta válida.
 */
export function createResearchPresenceService(deps: ResearchPresenceDeps) {
  return async (input: { agentRunId: string; workspaceId: string }) => {
    const output = await loadResearchOutput(deps.findRun, input.agentRunId, input.workspaceId);

    const business = await deps.repo.getByWorkspace(input.workspaceId);
    const context = business ? await deps.repo.getContext(business.id) : null;
    const current = (context?.currentVersion?.data ?? {}) as Record<string, unknown>;

    const presence = researchPresence(current, output);

    return {
      presentFindingIndexes: presence.findings.flatMap((present, index) => (present ? [index] : [])),
      presentOpportunityIndexes: presence.opportunities.flatMap((present, index) => (present ? [index] : [])),
    };
  };
}

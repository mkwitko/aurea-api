import { type Prisma, ContextSource } from '@prisma/client';
import { BadRequestError } from '../../../../lib/errors.js';
import type { BusinessRepository } from '../business.repository.js';
import type { RemoveResearchBody } from './remove-research.schema.js';
import { removeResearchFromContext, researchPresence } from '../research-context.js';
import { loadResearchOutput, pickFindings, pickOpportunities, type FindRun } from '../research-run.js';

export type RemoveResearchDeps = {
  repo: BusinessRepository;
  findRun: FindRun;
};

/**
 * Desfaz um aceite: tira do contexto o que estes achados haviam colocado lá.
 * Guardar sem poder desguardar transformava cada clique errado em dado
 * permanente, e o fundador só tinha a saída de editar o texto à mão na tela do
 * negócio sem saber de onde ele tinha vindo.
 *
 * A versão nova é USER, não RESEARCH: quem decidiu foi a pessoa. E a confiança
 * da versão anterior é preservada — remover uma linha não muda o quanto o
 * resto do contexto é sustentado.
 */
export function createRemoveResearchService(deps: RemoveResearchDeps) {
  return async (input: RemoveResearchBody & { workspaceId: string; userId: string }) => {
    const output = await loadResearchOutput(deps.findRun, input.agentRunId, input.workspaceId);

    const findings = pickFindings(output, input.findingIndexes);
    const opportunities = pickOpportunities(output, input.opportunityIndexes);

    const business = await deps.repo.getByWorkspace(input.workspaceId);
    if (!business) throw new BadRequestError('No business in this workspace');

    const context = await deps.repo.getContext(business.id);
    const current = (context?.currentVersion?.data ?? {}) as Record<string, unknown>;

    // O que não está no contexto não pode ser removido dele. Dizer isso é o
    // ponto: uma remoção que não removeu nada não pode devolver uma versão nova
    // como se tivesse removido.
    const presence = researchPresence(current, output);
    const skippedFindingIndexes = input.findingIndexes.filter((index) => !presence.findings[index]);
    const skippedOpportunityIndexes = input.opportunityIndexes.filter((index) => !presence.opportunities[index]);

    const stored = {
      findings: findings.filter((_, position) => presence.findings[input.findingIndexes[position]!]),
      opportunities: opportunities.filter((_, position) => presence.opportunities[input.opportunityIndexes[position]!]),
    };

    if (!stored.findings.length && !stored.opportunities.length) {
      return {
        version: context?.currentVersion ?? null,
        created: false,
        skippedFindingIndexes,
        skippedOpportunityIndexes,
      };
    }

    const version = await deps.repo.addContextVersion(business.id, {
      data: removeResearchFromContext(current, stored) as Prisma.InputJsonValue,
      source: ContextSource.USER,
      confidence: context?.currentVersion?.confidence ?? 'MEDIUM',
      createdBy: input.userId,
    });

    return { version, created: true, skippedFindingIndexes, skippedOpportunityIndexes };
  };
}

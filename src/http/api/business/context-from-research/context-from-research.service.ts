import { type Prisma, ContextSource, ConfidenceLevel } from '@prisma/client';
import { BadRequestError } from '../../../../lib/errors.js';
import type { BusinessRepository } from '../business.repository.js';
import type { FromResearchBody } from './context-from-research.schema.js';
import { applyResearchToContext, lowestConfidence, researchPresence } from '../research-context.js';
import { loadResearchOutput, pickFindings, pickOpportunities, type FindRun } from '../research-run.js';

export type FromResearchDeps = {
  repo: BusinessRepository;
  findRun: FindRun;
};

export function createFromResearchService(deps: FromResearchDeps) {
  return async (input: FromResearchBody & { workspaceId: string; userId: string }) => {
    const output = await loadResearchOutput(deps.findRun, input.agentRunId, input.workspaceId);

    const findings = pickFindings(output, input.findingIndexes);
    const opportunities = pickOpportunities(output, input.opportunityIndexes);

    const business = await deps.repo.getByWorkspace(input.workspaceId);
    if (!business) throw new BadRequestError('No business in this workspace');

    const context = await deps.repo.getContext(business.id);
    const current = (context?.currentVersion?.data ?? {}) as Record<string, unknown>;

    // O append é idempotente por valor, então aceitar de novo o que já está
    // guardado escrevia uma versão nova idêntica à anterior e devolvia 201: a
    // tela dizia "salvo", o contexto não mudava em nada, e o fundador concluía
    // que salvar não funciona. Agora o que já estava lá é dito, não fingido.
    const presence = researchPresence(current, output);
    const skippedFindingIndexes = input.findingIndexes.filter((index) => presence.findings[index]);
    const skippedOpportunityIndexes = input.opportunityIndexes.filter((index) => presence.opportunities[index]);

    const fresh = {
      findings: findings.filter((_, position) => !presence.findings[input.findingIndexes[position]!]),
      opportunities: opportunities.filter(
        (_, position) => !presence.opportunities[input.opportunityIndexes[position]!],
      ),
    };

    // Nada de novo: nenhuma versão é criada. Uma versão por clique sem nada a
    // gravar polui o histórico do contexto justamente onde ele serve para
    // auditar decisões, e a versão atual continua sendo a resposta certa.
    if (!fresh.findings.length && !fresh.opportunities.length && context?.currentVersion) {
      return {
        version: context.currentVersion,
        created: false,
        skippedFindingIndexes,
        skippedOpportunityIndexes,
      };
    }

    const version = await deps.repo.addContextVersion(business.id, {
      data: applyResearchToContext(current, fresh) as Prisma.InputJsonValue,
      source: ContextSource.RESEARCH,
      // A confiança sai da seleção inteira, não só do que era novo: é o que o
      // fundador afirmou nesta revisão.
      confidence: lowestConfidence([...findings, ...opportunities]) as ConfidenceLevel,
      createdBy: input.userId,
      sourceAgentRunId: input.agentRunId,
    });

    return { version, created: true, skippedFindingIndexes, skippedOpportunityIndexes };
  };
}

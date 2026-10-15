import type { ContextSource, ConfidenceLevel } from '@prisma/client';
import { NotFoundError } from '../../../../lib/errors.js';
import type { BusinessRepository } from '../business.repository.js';
import type { BusinessContextData } from '../business-context-data.schema.js';
import type { SectionMeta } from '../business.schema.js';
import type { UpdateSectionBody } from './update-section.schema.js';

export type UpdateSectionDeps = { repo: BusinessRepository };
export type UpdateSectionInput = {
  workspaceId: string;
  userId: string;
  body: UpdateSectionBody;
};

/** Em qual campo do contexto cada seção grava. */
const SECTION_FIELD = {
  company: 'companyProfile',
  products: 'products',
  competitive: 'competitiveLandscape',
  market: 'marketContext',
  constraints: 'constraints',
  performance: 'currentPerformance',
  activities: 'currentActivities',
  projects: 'projects',
  campaigns: 'campaigns',
} as const satisfies Record<UpdateSectionBody['section'], keyof BusinessContextData>;

export function updateSectionService(deps: UpdateSectionDeps) {
  return async ({ workspaceId, userId, body }: UpdateSectionInput) => {
    const business = await deps.repo.getByWorkspace(workspaceId);
    if (!business) throw new NotFoundError('No business in this workspace');

    const context = await deps.repo.getContext(business.id);
    const currentData = (context?.currentVersion?.data as BusinessContextData) ?? {};
    const currentMeta = (context?.currentVersion?.meta as SectionMeta | null) ?? {};

    const updatedData: BusinessContextData = {
      ...currentData,
      [SECTION_FIELD[body.section]]: body.data,
      lastReviewedAt: new Date().toISOString(),
    };

    // Este endpoint é sempre uma mão humana confirmando (ou corrigindo) uma
    // seção — inclusive quando `sourceAgentRunId` está presente, porque nesse
    // caso o fundador revisou a proposta e clicou Salvar. Marcar a seção como
    // USER aqui é o que apaga o selo de IA no painel: o servidor é a única
    // fonte de verdade sobre proveniência, então esta gravação tem que
    // refletir "um humano confirmou isto agora", não repetir o que a proposta
    // dizia antes de ser revisada. As outras seções ficam como estavam.
    const updatedMeta: SectionMeta = {
      ...currentMeta,
      [SECTION_FIELD[body.section]]: { source: 'USER' },
    };

    return deps.repo.addContextVersion(business.id, {
      data: updatedData,
      meta: updatedMeta,
      // A proveniência da VERSÃO segue o pedido: só é AI quando o cliente
      // aponta o run que produziu a proposta que o usuário revisou e salvou.
      // Independe da proveniência por SEÇÃO acima, que é sempre USER aqui.
      source: (body.sourceAgentRunId ? 'AI' : 'USER') as ContextSource,
      confidence: 'MEDIUM' as ConfidenceLevel,
      createdBy: userId,
      sourceAgentRunId: body.sourceAgentRunId,
    });
  };
}

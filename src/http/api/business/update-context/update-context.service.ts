import { type Prisma, ContextSource, ConfidenceLevel } from '@prisma/client';
import { NotFoundError } from '../../../../lib/errors.js';
import type { BusinessRepository } from '../business.repository.js';
import type { ContextUpdateBody } from './update-context.schema.js';

export type UpdateContextDeps = { repo: BusinessRepository };
export type UpdateContextInput = ContextUpdateBody & { workspaceId: string; userId: string };

export function updateContextService(deps: UpdateContextDeps) {
  return async (input: UpdateContextInput) => {
    const business = await deps.repo.getByWorkspace(input.workspaceId);
    if (!business) throw new NotFoundError('No business in this workspace');
    return deps.repo.addContextVersion(business.id, {
      data: input.data as Prisma.InputJsonValue,
      source: (input.source as ContextSource | undefined) ?? ContextSource.USER,
      confidence: (input.confidence as ConfidenceLevel | undefined) ?? ConfidenceLevel.MEDIUM,
      createdBy: input.userId,
    });
  };
}

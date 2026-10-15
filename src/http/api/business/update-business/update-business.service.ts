import { NotFoundError } from '../../../../lib/errors.js';
import type { BusinessRepository } from '../business.repository.js';
import type { BusinessUpdateBody } from './update-business.schema.js';

export type UpdateBusinessDeps = { repo: BusinessRepository };
export type UpdateBusinessInput = { workspaceId: string; body: BusinessUpdateBody };

export function updateBusinessService(deps: UpdateBusinessDeps) {
  return async (input: UpdateBusinessInput) => {
    const business = await deps.repo.getByWorkspace(input.workspaceId);
    if (!business) throw new NotFoundError('No business in this workspace');
    return deps.repo.update(business.id, input.body);
  };
}

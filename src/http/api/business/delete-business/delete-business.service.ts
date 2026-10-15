import { NotFoundError } from '../../../../lib/errors.js';
import type { BusinessRepository } from '../business.repository.js';

export type DeleteBusinessDeps = { repo: BusinessRepository };
export type DeleteBusinessInput = { workspaceId: string };

export function deleteBusinessService(deps: DeleteBusinessDeps) {
  return async (input: DeleteBusinessInput) => {
    const business = await deps.repo.getByWorkspace(input.workspaceId);
    if (!business) throw new NotFoundError('Business not found');

    await deps.repo.softDelete(business.id);
  };
}

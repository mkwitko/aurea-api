import { ConflictError } from '../../../../lib/errors.js';
import type { BusinessRepository } from '../business.repository.js';
import type { BusinessCreateBody } from './create-business.schema.js';

export type CreateBusinessDeps = { repo: BusinessRepository };
export type CreateBusinessInput = BusinessCreateBody & { workspaceId: string };

export function createBusinessService(deps: CreateBusinessDeps) {
  return async (input: CreateBusinessInput) => {
    const { workspaceId, ...data } = input;
    const existing = await deps.repo.getByWorkspace(workspaceId);
    if (existing) throw new ConflictError('This workspace already has a business');
    return deps.repo.create(workspaceId, data);
  };
}

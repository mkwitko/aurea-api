import { Priority } from '@prisma/client';
import { BadRequestError } from '../../../../lib/errors.js';
import type { GoalsRepository } from '../goals.repository.js';
import type { CreateGoalBody } from './create-goal.schema.js';

export type CreateGoalDeps = { repo: GoalsRepository };
export type CreateGoalInput = CreateGoalBody & { workspaceId: string };

export function createGoalService(deps: CreateGoalDeps) {
  return async (input: CreateGoalInput) => {
    const { icpIds = [], priority, workspaceId, ...rest } = input;
    if (icpIds.length > 0) {
      const found = await deps.repo.countIcps(workspaceId, icpIds);
      if (found !== new Set(icpIds).size) {
        throw new BadRequestError('One or more ICPs do not belong to this workspace');
      }
    }
    return deps.repo.create(workspaceId, { ...rest, priority: (priority as Priority) ?? Priority.MEDIUM }, icpIds);
  };
}

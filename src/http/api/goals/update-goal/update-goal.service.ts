import { type Prisma, Priority } from '@prisma/client';
import { BadRequestError, NotFoundError } from '../../../../lib/errors.js';
import type { GoalsRepository } from '../goals.repository.js';
import type { UpdateGoalBody } from './update-goal.schema.js';

export type UpdateGoalDeps = { repo: GoalsRepository };
export type UpdateGoalInput = { workspaceId: string; id: string; body: UpdateGoalBody };

export function updateGoalService(deps: UpdateGoalDeps) {
  return async (input: UpdateGoalInput) => {
    const existing = await deps.repo.findById(input.workspaceId, input.id);
    if (!existing) throw new NotFoundError('Goal not found');

    const { icpIds, priority, ...rest } = input.body;
    if (icpIds && icpIds.length > 0) {
      const found = await deps.repo.countIcps(input.workspaceId, icpIds);
      if (found !== new Set(icpIds).size) {
        throw new BadRequestError('One or more ICPs do not belong to this workspace');
      }
    }

    const data: Prisma.GoalUpdateInput = { ...rest, ...(priority ? { priority: priority as Priority } : {}) };
    return deps.repo.update(input.workspaceId, input.id, data, icpIds);
  };
}

import { NotFoundError } from '../../../../lib/errors.js';
import type { GoalsRepository } from '../goals.repository.js';

export type GetGoalDeps = { repo: GoalsRepository };

export function getGoalService(deps: GetGoalDeps) {
  return async (workspaceId: string, id: string) => {
    const goal = await deps.repo.findById(workspaceId, id);
    if (!goal) throw new NotFoundError('Goal not found');
    return goal;
  };
}

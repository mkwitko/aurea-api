import { type Prisma, GoalStatus } from '@prisma/client';
import { NotFoundError } from '../../../lib/errors.js';
import { assertGoalTransition } from './goals.domain.js';
import type { GoalsRepository } from './goals.repository.js';

export type TransitionGoalDeps = { repo: GoalsRepository };
export type TransitionGoalInput = {
  workspaceId: string;
  id: string;
  to: GoalStatus;
  extra?: Prisma.GoalUpdateInput;
};

// Shared by the activate/pause/complete/cancel controllers.
export function transitionGoalService(deps: TransitionGoalDeps) {
  return async (input: TransitionGoalInput) => {
    const goal = await deps.repo.findById(input.workspaceId, input.id);
    if (!goal) throw new NotFoundError('Goal not found');
    assertGoalTransition(goal.status, input.to);
    return deps.repo.setStatus(input.id, input.to, input.extra);
  };
}

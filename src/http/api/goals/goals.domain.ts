import { GoalStatus } from '@prisma/client';
import { BadRequestError } from '../../../lib/errors.js';

// Allowed goal lifecycle transitions. Terminal states cannot move.
const TRANSITIONS: Record<GoalStatus, GoalStatus[]> = {
  DRAFT: [GoalStatus.ACTIVE, GoalStatus.CANCELLED],
  ACTIVE: [GoalStatus.PAUSED, GoalStatus.COMPLETED, GoalStatus.CANCELLED],
  PAUSED: [GoalStatus.ACTIVE, GoalStatus.CANCELLED],
  COMPLETED: [],
  CANCELLED: [],
};

export function assertGoalTransition(from: GoalStatus, to: GoalStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new BadRequestError(`Cannot move goal from ${from} to ${to}`);
  }
}

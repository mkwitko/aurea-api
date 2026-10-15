import { createGoalBody } from '../create-goal/create-goal.schema.js';

export const updateGoalBody = createGoalBody.partial();
export type UpdateGoalBody = typeof updateGoalBody._type;

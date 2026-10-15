import type { FastifyPluginAsync } from 'fastify';
import { activateGoalRoute } from './activate-goal/activate-goal.controller.js';
import { cancelGoalRoute } from './cancel-goal/cancel-goal.controller.js';
import { completeGoalRoute } from './complete-goal/complete-goal.controller.js';
import { createGoalRoute } from './create-goal/create-goal.controller.js';
import { getGoalRoute } from './get-goal/get-goal.controller.js';
import { listGoalsRoute } from './list-goals/list-goals.controller.js';
import { pauseGoalRoute } from './pause-goal/pause-goal.controller.js';
import { updateGoalRoute } from './update-goal/update-goal.controller.js';

/** Registers all `goals` routes. Auth + tenant resolution applied at this scope. */
export const goalsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.resolveTenant);
  app.addHook('preHandler', app.denyReadOnly);

  await app.register(listGoalsRoute);
  await app.register(createGoalRoute);
  await app.register(getGoalRoute);
  await app.register(updateGoalRoute);
  await app.register(activateGoalRoute);
  await app.register(pauseGoalRoute);
  await app.register(completeGoalRoute);
  await app.register(cancelGoalRoute);
};

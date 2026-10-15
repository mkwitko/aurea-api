import type { FastifyPluginAsync } from 'fastify';
import { archiveLearningRoute } from './archive-learning/archive-learning.controller.js';
import { createLearningRoute } from './create-learning/create-learning.controller.js';
import { learningFromRunRoute } from './from-run/from-run.controller.js';
import { listLearningsRoute } from './list-learnings/list-learnings.controller.js';
import { rejectLearningRoute } from './reject-learning/reject-learning.controller.js';
import { validateLearningRoute } from './validate-learning/validate-learning.controller.js';

/** Registers all `learnings` routes. Auth, tenant and the read-only guard apply here. */
export const learningsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.resolveTenant);
  app.addHook('preHandler', app.denyReadOnly);

  await app.register(listLearningsRoute);
  await app.register(createLearningRoute);
  await app.register(learningFromRunRoute);
  await app.register(validateLearningRoute);
  await app.register(rejectLearningRoute);
  await app.register(archiveLearningRoute);
};

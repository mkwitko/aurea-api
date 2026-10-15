import type { FastifyPluginAsync } from 'fastify';
import { createHypothesisRoute } from './create-hypothesis/create-hypothesis.controller.js';
import { getHypothesisRoute } from './get-hypothesis/get-hypothesis.controller.js';
import { listHypothesesRoute } from './list-hypotheses/list-hypotheses.controller.js';
import { proposeHypothesisRoute } from './propose-hypothesis/propose-hypothesis.controller.js';
import { rejectHypothesisRoute } from './reject-hypothesis/reject-hypothesis.controller.js';
import { testHypothesisRoute } from './test-hypothesis/test-hypothesis.controller.js';
import { updateHypothesisRoute } from './update-hypothesis/update-hypothesis.controller.js';
import { validateHypothesisRoute } from './validate-hypothesis/validate-hypothesis.controller.js';

export const hypothesesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.resolveTenant);
  app.addHook('preHandler', app.denyReadOnly);

  await app.register(listHypothesesRoute);
  await app.register(getHypothesisRoute);
  await app.register(createHypothesisRoute);
  await app.register(updateHypothesisRoute);
  await app.register(proposeHypothesisRoute);
  await app.register(testHypothesisRoute);
  await app.register(validateHypothesisRoute);
  await app.register(rejectHypothesisRoute);
};

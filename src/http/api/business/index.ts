import type { FastifyPluginAsync } from 'fastify';
import { createBusinessRoute } from './create-business/create-business.controller.js';
import { getBusinessRoute } from './get-business/get-business.controller.js';
import { updateBusinessRoute } from './update-business/update-business.controller.js';
import { getContextRoute } from './get-context/get-context.controller.js';
import { updateContextRoute } from './update-context/update-context.controller.js';
import { updateSectionRoute } from './update-section/update-section.controller.js';
import { deleteBusinessRoute } from './delete-business/delete-business.controller.js';
import { contextFromResearchRoute } from './context-from-research/context-from-research.controller.js';
import { researchPresenceRoute } from './research-presence/research-presence.controller.js';
import { removeResearchRoute } from './remove-research/remove-research.controller.js';

export const businessRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.resolveTenant);
  app.addHook('preHandler', app.denyReadOnly);

  await app.register(createBusinessRoute);
  await app.register(getBusinessRoute);
  await app.register(updateBusinessRoute);
  await app.register(getContextRoute);
  await app.register(updateContextRoute);
  await app.register(updateSectionRoute);
  await app.register(deleteBusinessRoute);
  await app.register(contextFromResearchRoute);
  await app.register(researchPresenceRoute);
  await app.register(removeResearchRoute);
};

import type { FastifyPluginAsync } from 'fastify';
import { providerKeyController } from './provider-key.controller.js';

/** Registers the BYOK provider-key routes. Auth + tenant resolution at this scope. */
export const providerKeyRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.resolveTenant);

  await app.register(providerKeyController);
};

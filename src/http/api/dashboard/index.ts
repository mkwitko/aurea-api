import type { FastifyPluginAsync } from 'fastify';
import { getDashboardRoute } from './get-dashboard/get-dashboard.controller.js';

/**
 * Registers the `dashboard` route. The read-only guard is added for the same
 * reason every other module adds it: it covers routes not written yet.
 * `denyReadOnly` returns early on GET, so today it is a no-op here.
 */
export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.resolveTenant);
  app.addHook('preHandler', app.denyReadOnly);

  await app.register(getDashboardRoute);
};

import type { FastifyPluginAsync } from 'fastify';
import { getCreditsRoute } from './get-credits/get-credits.controller.js';
import { listLedgerRoute } from './list-ledger/list-ledger.controller.js';
import { getPricingRoute } from './get-pricing/get-pricing.controller.js';

/** Registers all `credits` routes. Auth + tenant resolution applied at this scope. */
export const creditsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.resolveTenant);

  await app.register(getCreditsRoute);
  await app.register(listLedgerRoute);
  await app.register(getPricingRoute);
};

import type { FastifyPluginAsync } from 'fastify';
import { getBillingRoute } from './get-billing/get-billing.controller.js';
import { getPlansRoute } from './get-plans/get-plans.controller.js';
import { createSubscriptionCheckoutRoute } from './create-subscription-checkout/create-subscription-checkout.controller.js';
import { createCreditPackCheckoutRoute } from './create-credit-pack-checkout/create-credit-pack-checkout.controller.js';
import { createPortalRoute } from './create-portal/create-portal.controller.js';
import { syncBillingRoute } from './sync-billing/sync-billing.controller.js';
import { changeSubscriptionPlanRoute } from './change-subscription-plan/change-subscription-plan.controller.js';

/** Registers all `billing` routes. Auth + tenant resolution applied at this scope. */
export const billingRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.resolveTenant);

  await app.register(getBillingRoute);
  await app.register(getPlansRoute);
  await app.register(createSubscriptionCheckoutRoute);
  await app.register(createCreditPackCheckoutRoute);
  await app.register(createPortalRoute);
  await app.register(syncBillingRoute);
  await app.register(changeSubscriptionPlanRoute);
};

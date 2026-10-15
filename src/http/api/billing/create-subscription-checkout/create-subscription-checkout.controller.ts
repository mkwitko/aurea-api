import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { assertOwner } from '../../../../lib/tenant.js';
import { actorEmail, billingDeps } from '../billing.deps.js';
import { checkoutUrlResponse, subscriptionCheckoutBody } from '../billing.schema.js';

export const createSubscriptionCheckoutRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/billing/checkout/subscription',
    {
      schema: {
        tags: ['billing'],
        operationId: 'createSubscriptionCheckout',
        body: subscriptionCheckoutBody,
        response: { 200: checkoutUrlResponse },
      },
    },
    async (req, reply) => {
      assertOwner(req.tenant);
      const url = await billingDeps(app).checkout.subscriptionUrl({
        organizationId: req.tenant.organizationId,
        workspaceId: req.tenant.workspaceId,
        plan: req.body.plan,
        email: await actorEmail(app, req.tenant.userId),
      });
      return reply.send({ url });
    },
  );
};

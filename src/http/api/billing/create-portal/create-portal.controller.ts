import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { assertOwner } from '../../../../lib/tenant.js';
import { actorEmail, billingDeps } from '../billing.deps.js';
import { checkoutUrlResponse } from '../billing.schema.js';

export const createPortalRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/billing/portal',
    { schema: { tags: ['billing'], operationId: 'createBillingPortal', response: { 200: checkoutUrlResponse } } },
    async (req, reply) => {
      assertOwner(req.tenant);
      const url = await billingDeps(app).checkout.portalUrl({
        organizationId: req.tenant.organizationId,
        email: await actorEmail(app, req.tenant.userId),
      });
      return reply.send({ url });
    },
  );
};

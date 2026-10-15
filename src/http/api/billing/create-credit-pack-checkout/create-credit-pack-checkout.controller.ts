import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { assertAdmin } from '../../../../lib/tenant.js';
import { actorEmail, billingDeps } from '../billing.deps.js';
import { checkoutUrlResponse, creditPackCheckoutBody } from '../billing.schema.js';

export const createCreditPackCheckoutRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/billing/checkout/credits',
    {
      schema: {
        tags: ['billing'],
        operationId: 'createCreditPackCheckout',
        body: creditPackCheckoutBody,
        response: { 200: checkoutUrlResponse },
      },
    },
    async (req, reply) => {
      // Recarga é operação de quem administra o workspace, não só do dono da
      // fatura: quem está sem crédito no meio do trabalho precisa resolver.
      assertAdmin(req.tenant);
      const url = await billingDeps(app).checkout.creditPackUrl({
        organizationId: req.tenant.organizationId,
        workspaceId: req.tenant.workspaceId,
        packId: req.body.packId,
        email: await actorEmail(app, req.tenant.userId),
      });
      return reply.send({ url });
    },
  );
};

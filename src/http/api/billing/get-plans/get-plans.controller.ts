import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { planCatalog } from '../../../../billing/plan-catalog.js';
import { packCatalog } from '../../../../billing/credit-packs.js';
import { plansResponse } from '../billing.schema.js';

export const getPlansRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/billing/plans',
    { schema: { tags: ['billing'], operationId: 'getBillingPlans', response: { 200: plansResponse } } },
    async (_req, reply) => {
      // Constante por deploy: nem banco, nem Stripe, nem tenant. Funciona sem
      // STRIPE_SECRET_KEY, como GET /billing — a tela de cobrança tem que abrir
      // mesmo num ambiente sem Stripe configurado.
      return reply.send({ plans: planCatalog(), packs: packCatalog() });
    },
  );
};

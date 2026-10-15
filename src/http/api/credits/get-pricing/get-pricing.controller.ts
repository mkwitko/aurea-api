import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { operationCatalog } from '../../../../billing/operation-cost.js';
import { pricingResponse } from '../credits.schema.js';

export const getPricingRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/credits/pricing',
    { schema: { tags: ['credits'], operationId: 'getCreditPricing', response: { 200: pricingResponse } } },
    async (_req, reply) => {
      // Só créditos. Preço de modelo e token são auditoria interna e não saem daqui.
      return reply.send({ operations: operationCatalog() });
    },
  );
};

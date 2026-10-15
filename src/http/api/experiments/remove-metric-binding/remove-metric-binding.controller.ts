import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { assertWriter } from '../../../../lib/tenant.js';
import { experimentIdParam } from '../experiments.schema.js';
import { createMetricBindingRepository } from '../metric-binding.repository.js';

export const removeMetricBindingRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().delete(
    '/experiments/:id/metric-binding',
    {
      schema: {
        tags: ['experiments'],
        operationId: 'removeMetricBinding',
        params: experimentIdParam,
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      assertWriter(req.tenant);
      // Sem 404 quando não havia nada: remover o que não existe deixa o mundo
      // no estado pedido.
      await createMetricBindingRepository(app.prisma).remove(req.tenant.workspaceId, req.params.id);
      return reply.code(204).send();
    },
  );
};

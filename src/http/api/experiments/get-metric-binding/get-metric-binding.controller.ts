import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { NotFoundError } from '../../../../lib/errors.js';
import { experimentIdParam } from '../experiments.schema.js';
import { createMetricBindingRepository } from '../metric-binding.repository.js';
import { metricBindingResponse } from '../metric-binding.schema.js';

export const getMetricBindingRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/experiments/:id/metric-binding',
    {
      schema: {
        tags: ['experiments'],
        operationId: 'getMetricBinding',
        params: experimentIdParam,
        response: { 200: metricBindingResponse },
      },
    },
    async (req, reply) => {
      const repo = createMetricBindingRepository(app.prisma);
      const binding = await repo.find(req.tenant.workspaceId, req.params.id);
      // Sem amarração, 404: não existe, e a tela decide se oferece o agente ou o
      // formulário. Nunca um objeto vazio fingindo amarração.
      if (!binding) throw new NotFoundError('Metric binding not found');
      return reply.send({ binding });
    },
  );
};

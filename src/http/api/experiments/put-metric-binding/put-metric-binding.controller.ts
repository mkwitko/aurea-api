import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { NotFoundError } from '../../../../lib/errors.js';
import { assertWriter } from '../../../../lib/tenant.js';
import { experimentIdParam } from '../experiments.schema.js';
import { createMetricBindingRepository } from '../metric-binding.repository.js';
import { metricBindingResponse, putMetricBindingBody } from '../metric-binding.schema.js';

export const putMetricBindingRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().put(
    '/experiments/:id/metric-binding',
    {
      schema: {
        tags: ['experiments'],
        operationId: 'putMetricBinding',
        params: experimentIdParam,
        body: putMetricBindingBody,
        response: { 200: metricBindingResponse },
      },
    },
    async (req, reply) => {
      assertWriter(req.tenant);
      const repo = createMetricBindingRepository(app.prisma);
      const experiment = await repo.experimentInWorkspace(req.tenant.workspaceId, req.params.id);
      if (!experiment) throw new NotFoundError('Experiment not found');

      const binding = await repo.upsert({
        workspaceId: req.tenant.workspaceId,
        experimentId: req.params.id,
        provider: req.body.provider,
        config: req.body.config,
        createdBy: req.tenant.userId,
      });

      return reply.send({ binding });
    },
  );
};

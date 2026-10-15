import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { NotFoundError } from '../../../../lib/errors.js';
import { createExperimentsRepository } from '../experiments.repository.js';
import { experimentIdParam, experimentResponse } from '../experiments.schema.js';

export const getExperimentRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/experiments/:id',
    { schema: { tags: ['experiments'], operationId: 'getExperiment', params: experimentIdParam, response: { 200: experimentResponse } } },
    async (req) => {
      const repo = createExperimentsRepository(app.prisma);
      const experiment = await repo.findById(req.tenant.workspaceId, req.params.id);
      if (!experiment) throw new NotFoundError('Experiment not found');
      return { experiment };
    },
  );
};

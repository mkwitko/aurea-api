import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ExperimentStatus } from '@prisma/client';
import { createExperimentsRepository } from '../experiments.repository.js';
import { experimentIdParam, experimentResponse } from '../experiments.schema.js';
import { transitionExperimentService } from '../experiments.transition.js';

export const pauseExperimentRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/experiments/:id/pause',
    { schema: { tags: ['experiments'], operationId: 'pauseExperiment', params: experimentIdParam, response: { 200: experimentResponse } } },
    async (req) => {
      const service = transitionExperimentService({ repo: createExperimentsRepository(app.prisma) });
      return { experiment: await service({ workspaceId: req.tenant.workspaceId, id: req.params.id, to: ExperimentStatus.PAUSED }) };
    },
  );
};

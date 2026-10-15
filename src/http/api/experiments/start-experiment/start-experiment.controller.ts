import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ExperimentStatus } from '@prisma/client';
import { createExperimentsRepository } from '../experiments.repository.js';
import { experimentIdParam, experimentResponse } from '../experiments.schema.js';
import { transitionExperimentService } from '../experiments.transition.js';

export const startExperimentRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/experiments/:id/start',
    { schema: { tags: ['experiments'], operationId: 'startExperiment', params: experimentIdParam, response: { 200: experimentResponse } } },
    async (req) => {
      const service = transitionExperimentService({ repo: createExperimentsRepository(app.prisma) });
      return {
        experiment: await service({
          workspaceId: req.tenant.workspaceId,
          id: req.params.id,
          to: ExperimentStatus.RUNNING,
          extra: (c) => ({ startDate: c.startDate ?? new Date() }),
        }),
      };
    },
  );
};

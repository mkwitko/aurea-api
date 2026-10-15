import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createExperimentsRepository } from '../experiments.repository.js';
import { experimentResponse } from '../experiments.schema.js';
import { experimentCreateBody } from './create-experiment.schema.js';
import { createExperimentService } from './create-experiment.service.js';

export const createExperimentRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/experiments',
    { schema: { tags: ['experiments'], operationId: 'createExperiment', body: experimentCreateBody, response: { 201: experimentResponse } } },
    async (req, reply) => {
      const service = createExperimentService({ repo: createExperimentsRepository(app.prisma) });
      const experiment = await service({ ...req.body, workspaceId: req.tenant.workspaceId });
      return reply.code(201).send({ experiment });
    },
  );
};

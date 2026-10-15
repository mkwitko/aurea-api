import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createExperimentsRepository } from '../experiments.repository.js';
import { experimentListQuery, experimentListResponse } from '../experiments.schema.js';

export const listExperimentsRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/experiments',
    { schema: { tags: ['experiments'], operationId: 'listExperiments', querystring: experimentListQuery, response: { 200: experimentListResponse } } },
    async (req) => {
      const repo = createExperimentsRepository(app.prisma);
      return { experiments: await repo.list(req.tenant.workspaceId, req.query) };
    },
  );
};

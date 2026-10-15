import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createLearningsRepository } from '../learnings.repository.js';
import { learningListQuery, learningListResponse } from '../learnings.schema.js';

export const listLearningsRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/learnings',
    { schema: { tags: ['learnings'], operationId: 'listLearnings', querystring: learningListQuery, response: { 200: learningListResponse } } },
    async (req) => {
      const repo = createLearningsRepository(app.prisma);
      return { learnings: await repo.list(req.tenant.workspaceId, req.query) };
    },
  );
};

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createHypothesesRepository } from '../hypotheses.repository.js';
import { hypothesisListQuery, hypothesisListResponse } from '../hypotheses.schema.js';

export const listHypothesesRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/hypotheses',
    { schema: { tags: ['hypotheses'], operationId: 'listHypotheses', querystring: hypothesisListQuery, response: { 200: hypothesisListResponse } } },
    async (req) => {
      const repo = createHypothesesRepository(app.prisma);
      return { hypotheses: await repo.list(req.tenant.workspaceId, req.query.strategyId) };
    },
  );
};

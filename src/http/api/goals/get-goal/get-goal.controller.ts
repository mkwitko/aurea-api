import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createGoalsRepository } from '../goals.repository.js';
import { goalIdParam, goalResponse } from '../goals.schema.js';
import { getGoalService } from './get-goal.service.js';

export const getGoalRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/goals/:id',
    { schema: { tags: ['goals'], operationId: 'getGoal', params: goalIdParam, response: { 200: goalResponse } } },
    async (req) => {
      const service = getGoalService({ repo: createGoalsRepository(app.prisma) });
      return { goal: await service(req.tenant.workspaceId, req.params.id) };
    },
  );
};

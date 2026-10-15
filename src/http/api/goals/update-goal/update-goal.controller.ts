import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createGoalsRepository } from '../goals.repository.js';
import { goalIdParam, goalResponse } from '../goals.schema.js';
import { updateGoalBody } from './update-goal.schema.js';
import { updateGoalService } from './update-goal.service.js';

export const updateGoalRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().patch(
    '/goals/:id',
    {
      schema: {
        tags: ['goals'],
        operationId: 'updateGoal',
        params: goalIdParam,
        body: updateGoalBody,
        response: { 200: goalResponse },
      },
    },
    async (req) => {
      const service = updateGoalService({ repo: createGoalsRepository(app.prisma) });
      return { goal: await service({ workspaceId: req.tenant.workspaceId, id: req.params.id, body: req.body }) };
    },
  );
};

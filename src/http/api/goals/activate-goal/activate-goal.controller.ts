import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { GoalStatus } from '@prisma/client';
import { createGoalsRepository } from '../goals.repository.js';
import { goalIdParam, goalResponse } from '../goals.schema.js';
import { transitionGoalService } from '../goals.transition.js';

export const activateGoalRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/goals/:id/activate',
    { schema: { tags: ['goals'], operationId: 'activateGoal', params: goalIdParam, response: { 200: goalResponse } } },
    async (req) => {
      const service = transitionGoalService({ repo: createGoalsRepository(app.prisma) });
      return { goal: await service({ workspaceId: req.tenant.workspaceId, id: req.params.id, to: GoalStatus.ACTIVE }) };
    },
  );
};

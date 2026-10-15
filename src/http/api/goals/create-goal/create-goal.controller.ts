import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createGoalsRepository } from '../goals.repository.js';
import { goalResponse } from '../goals.schema.js';
import { createGoalBody } from './create-goal.schema.js';
import { createGoalService } from './create-goal.service.js';

export const createGoalRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/goals',
    { schema: { tags: ['goals'], operationId: 'createGoal', body: createGoalBody, response: { 201: goalResponse } } },
    async (req, reply) => {
      const service = createGoalService({ repo: createGoalsRepository(app.prisma) });
      const goal = await service({ ...req.body, workspaceId: req.tenant.workspaceId });
      return reply.code(201).send({ goal });
    },
  );
};

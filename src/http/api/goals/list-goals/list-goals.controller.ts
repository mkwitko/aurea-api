import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createGoalsRepository } from '../goals.repository.js';
import { goalListResponse } from '../goals.schema.js';
import { listGoalsService } from './list-goals.service.js';

export const listGoalsRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/goals',
    { schema: { tags: ['goals'], operationId: 'listGoals', response: { 200: goalListResponse } } },
    async (req) => {
      const service = listGoalsService({ repo: createGoalsRepository(app.prisma) });
      return { goals: await service(req.tenant.workspaceId) };
    },
  );
};

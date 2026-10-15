import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createStrategiesRepository } from '../strategies.repository.js';
import { strategyListResponse } from '../strategies.schema.js';

export const listStrategiesRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/strategies',
    { schema: { tags: ['strategies'], operationId: 'listStrategies', response: { 200: strategyListResponse } } },
    async (req) => {
      const repo = createStrategiesRepository(app.prisma);
      return { strategies: await repo.list(req.tenant.workspaceId) };
    },
  );
};

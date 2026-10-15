import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { NotFoundError } from '../../../../lib/errors.js';
import { createStrategiesRepository } from '../strategies.repository.js';
import { strategyIdParam, strategyResponse } from '../strategies.schema.js';

export const getStrategyRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/strategies/:id',
    { schema: { tags: ['strategies'], operationId: 'getStrategy', params: strategyIdParam, response: { 200: strategyResponse } } },
    async (req) => {
      const repo = createStrategiesRepository(app.prisma);
      const strategy = await repo.findById(req.tenant.workspaceId, req.params.id);
      if (!strategy) throw new NotFoundError('Strategy not found');
      return { strategy };
    },
  );
};

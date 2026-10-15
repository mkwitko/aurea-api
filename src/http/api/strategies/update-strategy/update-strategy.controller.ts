import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { NotFoundError } from '../../../../lib/errors.js';
import { createStrategiesRepository } from '../strategies.repository.js';
import { strategyCreateBody } from '../create-strategy/create-strategy.schema.js';
import { strategyIdParam, strategyResponse } from '../strategies.schema.js';

const strategyUpdateBody = strategyCreateBody.partial();

export const updateStrategyRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().patch(
    '/strategies/:id',
    { schema: { tags: ['strategies'], operationId: 'updateStrategy', params: strategyIdParam, body: strategyUpdateBody, response: { 200: strategyResponse } } },
    async (req) => {
      const repo = createStrategiesRepository(app.prisma);
      const existing = await repo.findById(req.tenant.workspaceId, req.params.id);
      if (!existing) throw new NotFoundError('Strategy not found');
      const { goalIds, icpIds, ...data } = req.body;
      return { strategy: await repo.update(req.params.id, data, goalIds, icpIds) };
    },
  );
};

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { StrategyStatus } from '@prisma/client';
import { createStrategiesRepository } from '../strategies.repository.js';
import { strategyIdParam, strategyResponse } from '../strategies.schema.js';
import { transitionStrategyService } from '../strategies.transition.js';

export const activateStrategyRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/strategies/:id/activate',
    { schema: { tags: ['strategies'], operationId: 'activateStrategy', params: strategyIdParam, response: { 200: strategyResponse } } },
    async (req) => {
      const service = transitionStrategyService({ repo: createStrategiesRepository(app.prisma) });
      return { strategy: await service({ workspaceId: req.tenant.workspaceId, id: req.params.id, to: StrategyStatus.ACTIVE }) };
    },
  );
};

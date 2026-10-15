import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createStrategiesRepository } from '../strategies.repository.js';
import { strategyResponse } from '../strategies.schema.js';
import { strategyCreateBody } from './create-strategy.schema.js';
import { createStrategyService } from './create-strategy.service.js';

export const createStrategyRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/strategies',
    { schema: { tags: ['strategies'], operationId: 'createStrategy', body: strategyCreateBody, response: { 201: strategyResponse } } },
    async (req, reply) => {
      const service = createStrategyService({ repo: createStrategiesRepository(app.prisma) });
      const strategy = await service({ ...req.body, workspaceId: req.tenant.workspaceId });
      return reply.code(201).send({ strategy });
    },
  );
};

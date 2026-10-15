import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createAgentRunRepository } from '../../../../ai/agent-run/agent-run.repository.js';
import { createAgentRunService } from '../../agent-runs/create-agent-run/create-agent-run.service.js';
import { enqueueAgentRun } from '../../../../ai/queue/queue.js';
import { createStrategiesRepository } from '../strategies.repository.js';
import { planExperimentsParams, planExperimentsResponse } from './plan-experiments.schema.js';
import { createPlanExperimentsService } from './plan-experiments.service.js';

export const planExperimentsRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/strategies/:id/plan-experiments',
    {
      schema: {
        tags: ['strategies'],
        operationId: 'planStrategyExperiments',
        params: planExperimentsParams,
        response: { 202: planExperimentsResponse },
      },
    },
    async (req, reply) => {
      // Reusa o serviço de criação de run: é ele que valida input, roda o
      // precheck, cobra e deduplica. Reimplementar isso aqui seria um segundo
      // caminho de cobrança livre para divergir.
      const startRun = createAgentRunService({
        repo: createAgentRunRepository(app.prisma),
        enqueue: enqueueAgentRun,
        prisma: app.prisma,
      });

      const service = createPlanExperimentsService({
        repo: createStrategiesRepository(app.prisma),
        startRun,
      });

      const result = await service({ strategyId: req.params.id, tenant: req.tenant });
      return reply.code(202).send(result);
    },
  );
};

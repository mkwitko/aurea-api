import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createAgentRunRepository } from '../../../../ai/agent-run/agent-run.repository.js';
import { createAgentRunService } from '../../agent-runs/create-agent-run/create-agent-run.service.js';
import { enqueueAgentRun } from '../../../../ai/queue/queue.js';
import { createMeasurementReader, type MeasurementReader } from '../../../../measurement/read-measurement.js';
import { createOutcomesRepository } from '../outcomes.repository.js';
import { experimentIdParam, outcomeCreatedResponse } from '../outcomes.schema.js';
import { outcomeCreateBody } from './create-outcome.schema.js';
import { createOutcomeService } from './create-outcome.service.js';

/**
 * O leitor entra por opção de plugin, não por decorator no `app` — mesma razão
 * de `put-integration.controller.ts`: um teste que esquecesse de decorá-lo
 * cairia no leitor real e sairia chamando o Google de dentro da suíte.
 */
export type CreateOutcomeOptions = { read?: MeasurementReader };

export const createOutcomeRoute: FastifyPluginAsync<CreateOutcomeOptions> = async (app, opts) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/experiments/:id/outcomes',
    {
      schema: {
        tags: ['outcomes'],
        operationId: 'createOutcome',
        params: experimentIdParam,
        body: outcomeCreateBody,
        response: { 201: outcomeCreatedResponse },
      },
    },
    async (req, reply) => {
      // Mesmo serviço de criação de run que plan-experiments usa: input
      // validado, precheck, cobrança e deduplicação num só lugar.
      const startRun = createAgentRunService({
        repo: createAgentRunRepository(app.prisma),
        enqueue: enqueueAgentRun,
        prisma: app.prisma,
      });

      const readMeasurement = opts.read ?? createMeasurementReader({ prisma: app.prisma });

      const service = createOutcomeService({
        repo: createOutcomesRepository(app.prisma),
        startRun,
        readMeasurement,
      });
      const result = await service({
        ...req.body,
        workspaceId: req.tenant.workspaceId,
        experimentId: req.params.id,
        tenant: req.tenant,
      });

      return reply.code(201).send(result);
    },
  );
};

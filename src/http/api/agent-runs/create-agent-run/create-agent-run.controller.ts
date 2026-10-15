import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createAgentRunRepository } from '../../../../ai/agent-run/agent-run.repository.js';
import { enqueueAgentRun } from '../../../../ai/queue/queue.js';
import { createAgentRunService } from './create-agent-run.service.js';
import { agentRunResponse, createAgentRunBody } from '../agent-runs.schema.js';
import { presentAgentRun } from '../agent-runs.presenter.js';

export const createAgentRunRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/agent-runs',
    {
      schema: {
        tags: ['agent-runs'],
        operationId: 'createAgentRun',
        body: createAgentRunBody,
        response: { 202: agentRunResponse },
      },
    },
    async (req, reply) => {
      const service = createAgentRunService({
        repo: createAgentRunRepository(app.prisma),
        enqueue: enqueueAgentRun,
        prisma: app.prisma,
      });

      const run = await service({
        tenant: req.tenant,
        taskType: req.body.taskType,
        input: req.body.input,
      });

      return reply.code(202).send(await presentAgentRun(run));
    },
  );
};

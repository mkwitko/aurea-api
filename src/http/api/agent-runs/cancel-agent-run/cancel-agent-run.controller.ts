import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createAgentRunRepository } from '../../../../ai/agent-run/agent-run.repository.js';
import { removeAgentRunJob } from '../../../../ai/queue/queue.js';
import { publishRunEvent } from '../../../../ai/events/run-events.js';
import { createCreditRepository } from '../../../../billing/credit.repository.js';
import { createCreditService } from '../../../../billing/credit.service.js';
import { cancelAgentRunService } from './cancel-agent-run.service.js';
import { agentRunParams, agentRunResponse } from '../agent-runs.schema.js';
import { presentAgentRun } from '../agent-runs.presenter.js';

export const cancelAgentRunRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/agent-runs/:id/cancel',
    {
      schema: {
        tags: ['agent-runs'],
        operationId: 'cancelAgentRun',
        params: agentRunParams,
        response: { 200: agentRunResponse },
      },
    },
    async (req, reply) => {
      const credits = createCreditService({ repo: createCreditRepository(app.prisma) });
      const service = cancelAgentRunService({
        repo: createAgentRunRepository(app.prisma),
        removeJob: removeAgentRunJob,
        refund: (agentRunId) => credits.refund({ agentRunId, now: new Date() }),
        notify: (workspaceId, runId) => publishRunEvent(workspaceId, { runId, status: 'CANCELLED' }),
      });

      const run = await service({ tenant: req.tenant, id: req.params.id });

      return reply.send(await presentAgentRun(run));
    },
  );
};

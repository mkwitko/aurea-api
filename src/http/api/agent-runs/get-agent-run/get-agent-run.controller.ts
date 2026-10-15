import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createAgentRunRepository } from '../../../../ai/agent-run/agent-run.repository.js';
import { NotFoundError } from '../../../../lib/errors.js';
import { agentRunParams, agentRunResponse } from '../agent-runs.schema.js';
import { presentAgentRun } from '../agent-runs.presenter.js';

export const getAgentRunRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/agent-runs/:id',
    {
      schema: {
        tags: ['agent-runs'],
        operationId: 'getAgentRun',
        params: agentRunParams,
        response: { 200: agentRunResponse },
      },
    },
    async (req, reply) => {
      const repo = createAgentRunRepository(app.prisma);
      // Run de outro workspace é 404, não 403: existência é informação.
      const run = await repo.findInWorkspace(req.params.id, req.tenant.workspaceId);
      if (!run) throw new NotFoundError('Agent run not found');

      return reply.send(await presentAgentRun(run));
    },
  );
};

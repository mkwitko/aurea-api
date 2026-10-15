import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createAgentRunRepository } from '../../../../ai/agent-run/agent-run.repository.js';
import { agentRunListResponse, listAgentRunsQuery } from '../agent-runs.schema.js';
import { presentAgentRun } from '../agent-runs.presenter.js';

export const listAgentRunsRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/agent-runs',
    {
      schema: {
        tags: ['agent-runs'],
        operationId: 'listAgentRuns',
        querystring: listAgentRunsQuery,
        response: { 200: agentRunListResponse },
      },
    },
    async (req) => {
      const repo = createAgentRunRepository(app.prisma);
      const runs = await repo.listInWorkspace(req.tenant.workspaceId, req.query);
      // createTraceId é um hash, não I/O — uma página de runs não custa nada
      // mensurável mesmo em Promise.all.
      return { runs: await Promise.all(runs.map(presentAgentRun)) };
    },
  );
};

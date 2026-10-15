import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { proposalDraftParams, proposalDraftQuery, proposalDraftResponse } from './proposal-draft.schema.js';
import { createProposalDraftService } from './proposal-draft.service.js';

export const proposalDraftRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/strategies/from-proposal/:agentRunId/draft',
    {
      schema: {
        tags: ['strategies'],
        operationId: 'getProposalDraft',
        params: proposalDraftParams,
        querystring: proposalDraftQuery,
        response: { 200: proposalDraftResponse },
      },
    },
    async (req) => {
      const service = createProposalDraftService({
        // Run de outro workspace é indistinguível de inexistente.
        findRun: (id, workspaceId) => app.prisma.agentRun.findFirst({ where: { id, workspaceId } }),
      });

      return service({
        agentRunId: req.params.agentRunId,
        optionIndexes: req.query.optionIndexes,
        workspaceId: req.tenant.workspaceId,
      });
    },
  );
};

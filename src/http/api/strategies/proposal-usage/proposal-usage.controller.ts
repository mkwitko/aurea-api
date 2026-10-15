import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createStrategiesRepository } from '../strategies.repository.js';
import { proposalUsageQuery, proposalUsageResponse } from './proposal-usage.schema.js';
import { createProposalUsageService } from './proposal-usage.service.js';

export const proposalUsageRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/strategies/proposal-usage',
    {
      schema: {
        tags: ['strategies'],
        operationId: 'getProposalUsage',
        querystring: proposalUsageQuery,
        response: { 200: proposalUsageResponse },
      },
    },
    async (req) => {
      const service = createProposalUsageService({ repo: createStrategiesRepository(app.prisma) });
      return service({ agentRunId: req.query.agentRunId, workspaceId: req.tenant.workspaceId });
    },
  );
};

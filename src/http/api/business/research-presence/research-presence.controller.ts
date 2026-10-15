import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createBusinessRepository } from '../business.repository.js';
import { researchPresenceParams, researchPresenceResponse } from './research-presence.schema.js';
import { createResearchPresenceService } from './research-presence.service.js';

export const researchPresenceRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/business/context/from-research/:agentRunId',
    {
      schema: {
        tags: ['business'],
        operationId: 'getResearchPresence',
        params: researchPresenceParams,
        response: { 200: researchPresenceResponse },
      },
    },
    async (req) => {
      const service = createResearchPresenceService({
        repo: createBusinessRepository(app.prisma),
        findRun: (id, workspaceId) => app.prisma.agentRun.findFirst({ where: { id, workspaceId } }),
      });

      return service({ agentRunId: req.params.agentRunId, workspaceId: req.tenant.workspaceId });
    },
  );
};

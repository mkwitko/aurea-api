import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createStrategiesRepository } from '../strategies.repository.js';
import { strategyResponse } from '../strategies.schema.js';
import { fromProposalBody } from './create-from-proposal.schema.js';
import { createFromProposalService } from './create-from-proposal.service.js';

export const createFromProposalRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/strategies/from-proposal',
    {
      schema: {
        tags: ['strategies'],
        operationId: 'createStrategyFromProposal',
        body: fromProposalBody,
        response: { 201: strategyResponse },
      },
    },
    async (req, reply) => {
      const service = createFromProposalService({
        repo: createStrategiesRepository(app.prisma),
        // Run de outro workspace é indistinguível de inexistente.
        findRun: (id, workspaceId) => app.prisma.agentRun.findFirst({ where: { id, workspaceId } }),
      });

      const strategy = await service({ ...req.body, workspaceId: req.tenant.workspaceId });
      return reply.code(201).send({ strategy });
    },
  );
};

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createExperimentsRepository } from '../experiments.repository.js';
import { experimentResponse } from '../experiments.schema.js';
import { experimentFromProposalBody } from './from-proposal.schema.js';
import { createFromProposalExperimentService } from './from-proposal.service.js';

export const experimentFromProposalRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/experiments/from-proposal',
    {
      schema: {
        tags: ['experiments'],
        operationId: 'createExperimentFromProposal',
        body: experimentFromProposalBody,
        response: { 201: experimentResponse },
      },
    },
    async (req, reply) => {
      const service = createFromProposalExperimentService({
        repo: createExperimentsRepository(app.prisma),
        // Run de outro workspace é indistinguível de inexistente.
        findRun: (id, workspaceId) => app.prisma.agentRun.findFirst({ where: { id, workspaceId } }),
      });

      const experiment = await service({ agentRunId: req.body.agentRunId, workspaceId: req.tenant.workspaceId });
      return reply.code(201).send({ experiment });
    },
  );
};

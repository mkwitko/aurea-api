import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createLearningsRepository } from '../learnings.repository.js';
import { learningFromRunBody, learningResponse } from '../learnings.schema.js';
import { learningFromRunService } from './from-run.service.js';

export const learningFromRunRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/learnings/from-run',
    {
      schema: {
        tags: ['learnings'],
        operationId: 'createLearningFromRun',
        body: learningFromRunBody,
        response: { 201: learningResponse },
      },
    },
    async (req, reply) => {
      const service = learningFromRunService({
        repo: createLearningsRepository(app.prisma),
        findRun: (id, workspaceId) =>
          app.prisma.agentRun.findFirst({
            where: { id, workspaceId },
            select: { taskType: true, status: true, input: true, output: true },
          }),
      });
      const learning = await service({ agentRunId: req.body.agentRunId, workspaceId: req.tenant.workspaceId });
      return reply.status(201).send({ learning });
    },
  );
};

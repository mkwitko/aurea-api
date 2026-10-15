import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { LearningStatus } from '@prisma/client';
import { createLearningsRepository } from '../learnings.repository.js';
import { learningIdParam, learningResponse } from '../learnings.schema.js';
import { transitionLearningService } from '../learnings.transition.js';

export const rejectLearningRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/learnings/:id/reject',
    { schema: { tags: ['learnings'], operationId: 'rejectLearning', params: learningIdParam, response: { 200: learningResponse } } },
    async (req) => {
      const service = transitionLearningService({ repo: createLearningsRepository(app.prisma) });
      const learning = await service({
        workspaceId: req.tenant.workspaceId,
        id: req.params.id,
        to: LearningStatus.REJECTED,
        extra: {},
      });
      return { learning };
    },
  );
};

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { LearningStatus } from '@prisma/client';
import { createLearningsRepository } from '../learnings.repository.js';
import { learningIdParam, learningResponse } from '../learnings.schema.js';
import { transitionLearningService } from '../learnings.transition.js';

export const validateLearningRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/learnings/:id/validate',
    { schema: { tags: ['learnings'], operationId: 'validateLearning', params: learningIdParam, response: { 200: learningResponse } } },
    async (req) => {
      const service = transitionLearningService({ repo: createLearningsRepository(app.prisma) });
      const learning = await service({
        workspaceId: req.tenant.workspaceId,
        id: req.params.id,
        to: LearningStatus.VALIDATED,
        extra: { validatedAt: new Date() },
      });
      return { learning };
    },
  );
};

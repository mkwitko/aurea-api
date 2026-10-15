import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createLearningsRepository } from '../learnings.repository.js';
import { learningResponse } from '../learnings.schema.js';
import { learningCreateBody } from './create-learning.schema.js';
import { createLearningService } from './create-learning.service.js';

export const createLearningRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/learnings',
    { schema: { tags: ['learnings'], operationId: 'createLearning', body: learningCreateBody, response: { 201: learningResponse } } },
    async (req, reply) => {
      const service = createLearningService({ repo: createLearningsRepository(app.prisma) });
      const learning = await service({ ...req.body, workspaceId: req.tenant.workspaceId });
      return reply.code(201).send({ learning });
    },
  );
};

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createHypothesesRepository } from '../hypotheses.repository.js';
import { hypothesisResponse } from '../hypotheses.schema.js';
import { hypothesisCreateBody } from './create-hypothesis.schema.js';
import { createHypothesisService } from './create-hypothesis.service.js';

export const createHypothesisRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/hypotheses',
    { schema: { tags: ['hypotheses'], operationId: 'createHypothesis', body: hypothesisCreateBody, response: { 201: hypothesisResponse } } },
    async (req, reply) => {
      const service = createHypothesisService({ repo: createHypothesesRepository(app.prisma) });
      const hypothesis = await service({ ...req.body, workspaceId: req.tenant.workspaceId });
      return reply.code(201).send({ hypothesis });
    },
  );
};

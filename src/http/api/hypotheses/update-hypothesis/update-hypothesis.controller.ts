import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { NotFoundError } from '../../../../lib/errors.js';
import { createHypothesesRepository } from '../hypotheses.repository.js';
import { hypothesisCreateBody } from '../create-hypothesis/create-hypothesis.schema.js';
import { hypothesisIdParam, hypothesisResponse } from '../hypotheses.schema.js';

const hypothesisUpdateBody = hypothesisCreateBody.omit({ strategyId: true }).partial();

export const updateHypothesisRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().patch(
    '/hypotheses/:id',
    { schema: { tags: ['hypotheses'], operationId: 'updateHypothesis', params: hypothesisIdParam, body: hypothesisUpdateBody, response: { 200: hypothesisResponse } } },
    async (req) => {
      const repo = createHypothesesRepository(app.prisma);
      const existing = await repo.findById(req.tenant.workspaceId, req.params.id);
      if (!existing) throw new NotFoundError('Hypothesis not found');
      return { hypothesis: await repo.update(req.params.id, req.body) };
    },
  );
};

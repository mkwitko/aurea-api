import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { NotFoundError } from '../../../../lib/errors.js';
import { createHypothesesRepository } from '../hypotheses.repository.js';
import { hypothesisIdParam, hypothesisResponse } from '../hypotheses.schema.js';

export const getHypothesisRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/hypotheses/:id',
    { schema: { tags: ['hypotheses'], operationId: 'getHypothesis', params: hypothesisIdParam, response: { 200: hypothesisResponse } } },
    async (req) => {
      const repo = createHypothesesRepository(app.prisma);
      const hypothesis = await repo.findById(req.tenant.workspaceId, req.params.id);
      if (!hypothesis) throw new NotFoundError('Hypothesis not found');
      return { hypothesis };
    },
  );
};

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { HypothesisStatus } from '@prisma/client';
import { createHypothesesRepository } from '../hypotheses.repository.js';
import { hypothesisIdParam, hypothesisResponse } from '../hypotheses.schema.js';
import { transitionHypothesisService } from '../hypotheses.transition.js';

export const proposeHypothesisRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/hypotheses/:id/propose',
    { schema: { tags: ['hypotheses'], operationId: 'proposeHypothesis', params: hypothesisIdParam, response: { 200: hypothesisResponse } } },
    async (req) => {
      const service = transitionHypothesisService({ repo: createHypothesesRepository(app.prisma) });
      return { hypothesis: await service({ workspaceId: req.tenant.workspaceId, id: req.params.id, to: HypothesisStatus.PROPOSED }) };
    },
  );
};

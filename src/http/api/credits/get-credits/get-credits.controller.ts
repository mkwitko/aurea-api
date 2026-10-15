import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createCreditRepository } from '../../../../billing/credit.repository.js';
import { createCreditService } from '../../../../billing/credit.service.js';
import { creditsResponse } from '../credits.schema.js';
import { presentCredits } from '../credits.presenter.js';

export const getCreditsRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/credits',
    { schema: { tags: ['credits'], operationId: 'getCredits', response: { 200: creditsResponse } } },
    async (req, reply) => {
      // Leitura de saldo é para qualquer membro, inclusive VIEWER: saber quanto
      // resta não é escrita.
      const service = createCreditService({ repo: createCreditRepository(app.prisma) });
      return reply.send(presentCredits(await service.summary(req.tenant.workspaceId, new Date())));
    },
  );
};

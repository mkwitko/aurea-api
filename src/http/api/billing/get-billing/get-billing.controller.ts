import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { NotFoundError } from '../../../../lib/errors.js';
import { createBillingRepository } from '../../../../billing/billing.repository.js';
import { billingResponse } from '../billing.schema.js';
import { presentBilling } from '../billing.presenter.js';

export const getBillingRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/billing',
    { schema: { tags: ['billing'], operationId: 'getBilling', response: { 200: billingResponse } } },
    async (req, reply) => {
      // Ler o plano é para qualquer membro, inclusive VIEWER: saber em que
      // plano o time está não é escrita e não expõe dinheiro.
      const repo = createBillingRepository(app.prisma);
      const org = await repo.organizationById(req.tenant.organizationId);
      if (!org) throw new NotFoundError('Organization not found');
      const count = await repo.countActiveWorkspaces(org.id);
      return reply.send(presentBilling(org, count));
    },
  );
};

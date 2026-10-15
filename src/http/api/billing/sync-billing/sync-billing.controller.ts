import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { NotFoundError } from '../../../../lib/errors.js';
import { assertAdmin } from '../../../../lib/tenant.js';
import { billingDeps } from '../billing.deps.js';
import { billingResponse } from '../billing.schema.js';
import { presentBilling } from '../billing.presenter.js';

export const syncBillingRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/billing/sync',
    { schema: { tags: ['billing'], operationId: 'syncBilling', response: { 200: billingResponse } } },
    async (req, reply) => {
      assertAdmin(req.tenant);
      const { repo, checkout } = billingDeps(app);
      await checkout.sync({ organizationId: req.tenant.organizationId, now: new Date() });

      const org = await repo.organizationById(req.tenant.organizationId);
      if (!org) throw new NotFoundError('Organization not found');
      return reply.send(presentBilling(org, await repo.countActiveWorkspaces(org.id)));
    },
  );
};

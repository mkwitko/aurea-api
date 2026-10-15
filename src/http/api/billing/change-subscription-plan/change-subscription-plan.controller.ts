import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { NotFoundError } from '../../../../lib/errors.js';
import { assertOwner } from '../../../../lib/tenant.js';
import { billingDeps } from '../billing.deps.js';
import { billingResponse, subscriptionCheckoutBody } from '../billing.schema.js';
import { presentBilling } from '../billing.presenter.js';

// Troca de plano de verdade: `subscriptions.update` com proração, não uma
// segunda Checkout Session (essa só cria assinatura — ver checkout.service.js
// changePlan). Mesma guarda de papel de POST /billing/checkout/subscription:
// é quem tem o cartão e o CNPJ.
export const changeSubscriptionPlanRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/billing/subscription/plan',
    {
      schema: {
        tags: ['billing'],
        operationId: 'changeSubscriptionPlan',
        body: subscriptionCheckoutBody,
        response: { 200: billingResponse },
      },
    },
    async (req, reply) => {
      assertOwner(req.tenant);
      const { repo, checkout } = billingDeps(app);
      await checkout.changePlan({
        organizationId: req.tenant.organizationId,
        plan: req.body.plan,
        now: new Date(),
      });

      const org = await repo.organizationById(req.tenant.organizationId);
      if (!org) throw new NotFoundError('Organization not found');
      return reply.send(presentBilling(org, await repo.countActiveWorkspaces(org.id)));
    },
  );
};

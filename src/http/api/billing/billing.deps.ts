import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '../../../lib/errors.js';
import { createBillingRepository } from '../../../billing/billing.repository.js';
import { createCheckoutService } from '../../../billing/checkout.service.js';
import { createCreditRepository } from '../../../billing/credit.repository.js';
import { createCreditService } from '../../../billing/credit.service.js';
import { createStripeClient } from '../../../billing/stripe-client.js';
import { createSubscriptionService } from '../../../billing/subscription.service.js';

// `app.stripe` existe para o teste injetar um fake sem tocar a rede; em
// produção é createStripeClient, que lança BILLING_NOT_CONFIGURED sem chave.
export function billingDeps(app: FastifyInstance) {
  const repo = createBillingRepository(app.prisma);
  const stripe = (app.stripe ?? createStripeClient)();
  const creditRepo = createCreditRepository(app.prisma);
  const subscriptions = createSubscriptionService({
    repo,
    credits: createCreditService({ repo: creditRepo }),
    periods: creditRepo,
    log: (info) => app.log.info(info, 'stripe event'),
  });
  return { repo, checkout: createCheckoutService({ repo, stripe, subscriptions }), subscriptions };
}

export async function actorEmail(app: FastifyInstance, userId: string): Promise<string> {
  const user = await app.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) throw new NotFoundError('User not found');
  return user.email;
}

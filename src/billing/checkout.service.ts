import type { Plan } from '@prisma/client';
import { env } from '../config/env.js';
import { BillingNotConfiguredError, NoActiveSubscriptionError, NotFoundError } from '../lib/errors.js';
import type { BillingRepository, OrgBilling } from './billing.repository.js';
import { priceForPack, type PackId } from './credit-packs.js';
import { planForPrice } from './plan-catalog.js';
import type { StripeClient } from './stripe-client.js';
import { eventFromPaidSession, eventFromSnapshot } from './stripe-event.js';
import type { SubscriptionService } from './subscription.service.js';

const RETURN_PATH = '/app/settings/billing';

function successUrl(): string {
  return `${env.APP_URL}${RETURN_PATH}?checkout=success`;
}

function cancelUrl(): string {
  return `${env.APP_URL}${RETURN_PATH}?checkout=cancel`;
}

function priceForPlan(plan: Plan): string {
  const configured = { STARTER: env.STRIPE_PRICE_STARTER, GROWTH: env.STRIPE_PRICE_GROWTH, SCALE: env.STRIPE_PRICE_SCALE }[plan];
  // Price não configurado é a mesma falha operacional que chave ausente — spec §9
  // dá um nome só a ela: BILLING_NOT_CONFIGURED, 500. Não é 404 (o plano existe,
  // o cliente pediu certo) e a mensagem interna não vai no corpo da resposta.
  // planForPrice devolveria null no caminho de volta, então falhar aqui evita uma
  // sessão que nenhum evento sabe aplicar.
  if (!configured || !planForPrice(configured)) throw new BillingNotConfiguredError();
  return configured;
}

export type CheckoutServiceDeps = {
  repo: BillingRepository;
  stripe: StripeClient;
  subscriptions: SubscriptionService;
};

export function createCheckoutService(deps: CheckoutServiceDeps) {
  const { repo, stripe, subscriptions } = deps;

  async function organization(organizationId: string): Promise<OrgBilling> {
    const found = await repo.organizationById(organizationId);
    if (!found) throw new NotFoundError('Organization not found');
    return found;
  }

  // O id que vale é o que a organização passou a guardar, não o que acabou de
  // nascer no Stripe: numa corrida entre dois checkouts só um dos Customers fica
  // gravado, e abrir a sessão no outro entrega um pagamento que nenhum handler
  // sabe resolver depois.
  async function customerId(org: OrgBilling, email: string): Promise<string> {
    if (org.stripeCustomerId) return org.stripeCustomerId;
    const created = await stripe.ensureCustomer({ organizationId: org.id, email, name: org.name });
    return repo.claimCustomerId(org.id, created);
  }

  return {
    async subscriptionUrl(input: { organizationId: string; workspaceId: string; plan: Plan; email: string }) {
      const org = await organization(input.organizationId);
      const session = await stripe.createSubscriptionCheckout({
        customerId: await customerId(org, input.email),
        priceId: priceForPlan(input.plan),
        organizationId: org.id,
        workspaceId: input.workspaceId,
        successUrl: successUrl(),
        cancelUrl: cancelUrl(),
      });
      return session.url;
    },

    async creditPackUrl(input: { organizationId: string; workspaceId: string; packId: PackId; email: string }) {
      const org = await organization(input.organizationId);
      const session = await stripe.createPackCheckout({
        customerId: await customerId(org, input.email),
        priceId: priceForPack(input.packId),
        organizationId: org.id,
        workspaceId: input.workspaceId,
        packId: input.packId,
        successUrl: successUrl(),
        cancelUrl: cancelUrl(),
      });
      return session.url;
    },

    // Troca de plano de verdade, não uma segunda Checkout Session: aquela só cria
    // assinatura, e abrir outra numa organização já ACTIVE deixava as duas
    // cobrando ao mesmo tempo (o achado crítico que motivou esta rota). Exige
    // assinatura registrada e em estado que ainda cobra — ACTIVE ou PAST_DUE,
    // os dois únicos status que pagam franquia (plan-catalog.effectiveAllowance)
    // — senão não há o que trocar.
    //
    // O evento que aplica o resultado é o MESMO subscription-state que o
    // webhook produz (via eventFromSnapshot). O Stripe também entrega
    // customer.subscription.updated para esta mesma troca; as duas cópias
    // colidem na mesma chave de idempotência do grant
    // (subscription.service.grantPlanChange), então o delta do upgrade entra
    // uma vez só, não duas.
    async changePlan(input: { organizationId: string; plan: Plan; now: Date }): Promise<void> {
      const org = await organization(input.organizationId);
      const stillCharging = org.subscriptionStatus === 'ACTIVE' || org.subscriptionStatus === 'PAST_DUE';
      if (!org.stripeSubscriptionId || !stillCharging) throw new NoActiveSubscriptionError();

      const snapshot = await stripe.changeSubscriptionPlan({
        subscriptionId: org.stripeSubscriptionId,
        priceId: priceForPlan(input.plan),
      });
      // stripeCustomerId sempre presente aqui: uma assinatura não existe sem
      // Customer, e o guard acima já exigiu stripeSubscriptionId.
      await subscriptions.apply(eventFromSnapshot(org.stripeCustomerId ?? '', snapshot), input.now);
    },

    async portalUrl(input: { organizationId: string; email: string }) {
      const org = await organization(input.organizationId);
      const session = await stripe.createPortalSession({
        customerId: await customerId(org, input.email),
        returnUrl: `${env.APP_URL}${RETURN_PATH}`,
      });
      return session.url;
    },

    // Rede de segurança para evento perdido, servidor fora do ar na hora do
    // webhook, e desenvolvimento sem túnel. Não é uma segunda implementação da
    // regra: entrega os mesmos BillingEvent aos mesmos handlers.
    async sync(input: { organizationId: string; now: Date }) {
      const org = await organization(input.organizationId);
      if (!org.stripeCustomerId) return;

      const snapshot = await stripe.fetchSubscription(org.stripeCustomerId);
      if (snapshot) await subscriptions.apply(eventFromSnapshot(org.stripeCustomerId, snapshot), input.now);

      for (const session of await stripe.listRecentPaidSessions(org.stripeCustomerId)) {
        await subscriptions.apply(eventFromPaidSession(session), input.now);
      }

      await repo.touchSync(org.id, input.now);
    },
  };
}

export type CheckoutService = ReturnType<typeof createCheckoutService>;

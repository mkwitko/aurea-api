import Stripe from 'stripe';
import { env } from '../config/env.js';
import { BillingNotConfiguredError } from '../lib/errors.js';

export type StripeSubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'trialing'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid'
  | 'paused';

export type SubscriptionSnapshot = {
  subscriptionId: string;
  priceId: string;
  status: StripeSubscriptionStatus;
  currentPeriodEnd: Date;
  metadata: Record<string, string>;
};

export type PaidSession = {
  sessionId: string;
  // O Customer que pagou, para o handler poder verificar a organização do
  // metadata contra ele antes de creditar.
  customerId: string;
  metadata: Record<string, string>;
};

export type StripeEventPayload = { id: string; type: string; object: unknown };

// Erro de leitura, não do catálogo: quem lê a resposta 400 é o Stripe, não uma
// pessoa. Só a falha de verificação de assinatura vira isto — qualquer outro
// erro do SDK (JSON corrompido, etc.) propaga como está.
export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

export type StripeClient = {
  ensureCustomer(input: { organizationId: string; email: string; name: string }): Promise<string>;
  createSubscriptionCheckout(input: {
    customerId: string;
    priceId: string;
    organizationId: string;
    workspaceId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }>;
  createPackCheckout(input: {
    customerId: string;
    priceId: string;
    organizationId: string;
    workspaceId: string;
    packId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }>;
  createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  constructEvent(rawBody: Buffer, signature: string): StripeEventPayload;
  fetchSubscription(customerId: string): Promise<SubscriptionSnapshot | null>;
  listRecentPaidSessions(customerId: string): Promise<PaidSession[]>;
  // Troca de plano de verdade: atualiza o item da assinatura existente para o
  // price novo, com proração. Não é uma segunda Checkout Session — aquela só
  // sabe CRIAR assinatura, e uma segunda sessão numa assinatura ACTIVE deixava
  // o cliente pagando as duas ao mesmo tempo.
  changeSubscriptionPlan(input: { subscriptionId: string; priceId: string }): Promise<SubscriptionSnapshot>;
};

type RawSubscriptionItem = { current_period_end: number; price: { id: string } };
export type RawSubscription = {
  id: string;
  status: string;
  metadata?: Record<string, string> | null;
  items: { data: RawSubscriptionItem[] };
};

// O fim do período corrente vive no item da assinatura, não na assinatura.
// Assinatura sem item é assinatura que não sabemos precificar: falha alto em
// vez de gravar um período inválido.
export function toSubscriptionSnapshot(raw: RawSubscription): SubscriptionSnapshot {
  const item = raw.items.data[0];
  if (!item) throw new Error(`subscription ${raw.id} has no item`);

  return {
    subscriptionId: raw.id,
    priceId: item.price.id,
    status: raw.status as StripeSubscriptionStatus,
    currentPeriodEnd: new Date(item.current_period_end * 1000),
    metadata: raw.metadata ?? {},
  };
}

export function isBillingConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

export function createStripeClient(): StripeClient {
  const secret = env.STRIPE_SECRET_KEY;
  if (!secret) throw new BillingNotConfiguredError();

  const stripe = new Stripe(secret);

  return {
    // Um Customer por organização. `search` em vez de guardar-e-torcer: se o id
    // gravado sumiu (conta trocada, banco restaurado), reencontra pelo metadata.
    async ensureCustomer(input) {
      const found = await stripe.customers.search({
        // A query é uma linguagem com literais entre apóstrofos: um id com
        // apóstrofo fecharia o literal. UUID hoje, mas o que sustenta isso é o
        // tipo da coluna, não este arquivo.
        query: `metadata['organizationId']:'${input.organizationId.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`,
        limit: 1,
      });
      const existing = found.data[0];
      if (existing) return existing.id;

      const created = await stripe.customers.create(
        {
          email: input.email,
          name: input.name,
          metadata: { organizationId: input.organizationId },
        },
        // A Search API é eventualmente consistente (até ~1 minuto): duas
        // chamadas a milissegundos de distância não se veem, e sem esta chave
        // nasceriam dois Customers para a mesma organização — um deles órfão,
        // ainda carregando o organizationId no metadata. Com a chave, o Stripe
        // devolve o mesmo Customer para a segunda chamada.
        { idempotencyKey: `customer:${input.organizationId}` },
      );
      return created.id;
    },

    async createSubscriptionCheckout(input) {
      const metadata = { organizationId: input.organizationId, workspaceId: input.workspaceId };
      const session = await stripe.checkout.sessions.create({
        customer: input.customerId,
        mode: 'subscription',
        line_items: [{ price: input.priceId, quantity: 1 }],
        allow_promotion_codes: true,
        metadata,
        // A assinatura precisa carregar o metadata também: os eventos
        // customer.subscription.* não veem o metadata da sessão, e sem o
        // workspaceId o upgrade no meio do mês não sabe onde lançar a diferença.
        subscription_data: { metadata },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      });
      if (!session.url) throw new Error('stripe returned a checkout session without a url');
      return { url: session.url };
    },

    async createPackCheckout(input) {
      const session = await stripe.checkout.sessions.create({
        customer: input.customerId,
        mode: 'payment',
        line_items: [{ price: input.priceId, quantity: 1 }],
        allow_promotion_codes: true,
        // packId no metadata: o payload do webhook não traz line_items, então é
        // por aqui que o handler descobre quantos créditos lançar.
        metadata: {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          packId: input.packId,
        },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      });
      if (!session.url) throw new Error('stripe returned a checkout session without a url');
      return { url: session.url };
    },

    async createPortalSession(input) {
      const session = await stripe.billingPortal.sessions.create({
        customer: input.customerId,
        return_url: input.returnUrl,
      });
      return { url: session.url };
    },

    constructEvent(rawBody, signature) {
      const secretWebhook = env.STRIPE_WEBHOOK_SECRET;
      // Segredo ausente é falha de configuração, não assinatura ruim: fica de
      // fora do catch abaixo, que só existe para reclassificar UM tipo de erro.
      if (!secretWebhook) throw new BillingNotConfiguredError();

      let event;
      try {
        event = stripe.webhooks.constructEvent(rawBody, signature, secretWebhook);
      } catch (err) {
        // Estreito de propósito: o SDK verifica a assinatura ANTES de dar
        // JSON.parse no corpo. Só a verificação vira 400 pro Stripe — um
        // JSON.parse corrompido depois de assinatura válida (ou qualquer outro
        // erro do SDK) é bug nosso e precisa propagar como 500, visível no
        // painel do Stripe. Não alargar este catch para "simplificar".
        if (err instanceof Stripe.errors.StripeSignatureVerificationError) {
          throw new WebhookSignatureError(err.message);
        }
        throw err;
      }
      return { id: event.id, type: event.type, object: event.data.object };
    },

    async fetchSubscription(customerId) {
      const list = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 1 });
      const raw = list.data[0];
      return raw ? toSubscriptionSnapshot(raw as unknown as RawSubscription) : null;
    },

    // `subscriptions.update` no MESMO item, não uma Checkout Session nova: a
    // assinatura já existe, e criar outra deixaria as duas cobrando ao mesmo
    // tempo. `create_prorations` é o que lança o ajuste do meio do ciclo na
    // próxima fatura — o crédito de créditos AI é uma conta à parte, resolvida
    // por quem chama este método através do snapshot devolvido.
    async changeSubscriptionPlan(input) {
      const subscription = await stripe.subscriptions.retrieve(input.subscriptionId);
      const item = subscription.items.data[0];
      if (!item) throw new Error(`subscription ${input.subscriptionId} has no item`);

      const updated = await stripe.subscriptions.update(input.subscriptionId, {
        items: [{ id: item.id, price: input.priceId }],
        proration_behavior: 'create_prorations',
      });
      return toSubscriptionSnapshot(updated as unknown as RawSubscription);
    },

    async listRecentPaidSessions(customerId) {
      const list = await stripe.checkout.sessions.list({ customer: customerId, limit: 20 });
      return list.data
        .filter((s) => s.mode === 'payment' && s.payment_status === 'paid')
        .map((s) => ({
          sessionId: s.id,
          // `customer` vem como id ou como objeto expandido, dependendo da
          // chamada; sem ele a sessão não é atribuível a ninguém.
          customerId: typeof s.customer === 'string' ? s.customer : (s.customer?.id ?? ''),
          metadata: (s.metadata ?? {}) as Record<string, string>,
        }))
        .filter((s) => s.customerId !== '');
    },
  };
}

import type { Plan, SubscriptionStatus } from '@prisma/client';
import { isPackId, type PackId } from './credit-packs.js';
import { planForPrice } from './plan-catalog.js';
import type { PaidSession, StripeEventPayload, SubscriptionSnapshot } from './stripe-client.js';

export type BillingEvent =
  | {
      kind: 'credit-purchase';
      sourceId: string;
      // O Customer que realmente pagou. É contra ele que a organização do
      // metadata é verificada — metadata é entrada não confiável (spec §10).
      customerId: string;
      organizationId: string;
      workspaceId: string;
      packId: PackId;
    }
  | {
      kind: 'subscription-state';
      customerId: string;
      subscriptionId: string;
      plan: Plan;
      status: SubscriptionStatus;
      currentPeriodEnd: Date;
      workspaceId: string | null;
    }
  // O id da assinatura que morreu viaja com o evento: o Stripe não garante ordem
  // e reentrega por até três dias, então cancelar sem saber QUAL assinatura acabou
  // zera a franquia de quem já reassinou.
  | { kind: 'subscription-canceled'; customerId: string; subscriptionId: string }
  | { kind: 'ignored'; reason: string };

// Fail closed: status que não conhecemos não paga franquia. Um estado novo
// inventado pelo Stripe não pode virar crédito de graça por omissão.
export function toSubscriptionStatus(stripeStatus: string): SubscriptionStatus {
  if (stripeStatus === 'active' || stripeStatus === 'trialing') return 'ACTIVE';
  if (stripeStatus === 'past_due' || stripeStatus === 'unpaid') return 'PAST_DUE';
  return 'CANCELED';
}

// Objeto de verdade ou nada. Sem o teste de tipo, qualquer valor não-nulo era
// tratado como registro e a leitura seguinte estourava — e no webhook um
// TypeError é 500 num evento que nunca vai passar, ou seja, uma pílula
// envenenada que o Stripe reentrega por três dias.
function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function purchaseFrom(sessionId: string, customerId: string, metadata: Record<string, unknown>): BillingEvent {
  const organizationId = text(metadata.organizationId);
  const workspaceId = text(metadata.workspaceId);
  const packId = text(metadata.packId);

  // Sem metadata, o pagamento existe e não sabemos onde creditar. Ignorar é a
  // única saída honesta: creditar por adivinhação é pior que não creditar.
  if (!organizationId || !workspaceId || !packId) return { kind: 'ignored', reason: 'purchase without metadata' };
  if (!isPackId(packId)) return { kind: 'ignored', reason: `unknown pack ${packId}` };

  return { kind: 'credit-purchase', sourceId: sessionId, customerId, organizationId, workspaceId, packId };
}

function subscriptionFrom(customerId: string, raw: Record<string, unknown>): BillingEvent {
  // Nada de cast direto: o payload é entrada externa, e cada degrau é conferido
  // para o malformado sair como 'ignored' em vez de TypeError.
  const items = asRecord(raw.items).data;
  const item = asRecord(Array.isArray(items) ? items[0] : undefined);

  const priceId = text(asRecord(item.price).id);
  if (!priceId) return { kind: 'ignored', reason: 'subscription without item' };

  const periodEnd = item.current_period_end;
  if (typeof periodEnd !== 'number' || !Number.isFinite(periodEnd)) {
    return { kind: 'ignored', reason: 'subscription item without a period end' };
  }

  const plan = planForPrice(priceId);
  if (!plan) return { kind: 'ignored', reason: `unknown price ${priceId}` };

  const subscriptionId = text(raw.id);
  if (!subscriptionId) return { kind: 'ignored', reason: 'subscription without id' };

  return {
    kind: 'subscription-state',
    customerId,
    subscriptionId,
    plan,
    status: toSubscriptionStatus(String(raw.status)),
    currentPeriodEnd: new Date(periodEnd * 1000),
    workspaceId: text(asRecord(raw.metadata).workspaceId),
  };
}

export function normalizeEvent(payload: StripeEventPayload): BillingEvent {
  const object = asRecord(payload.object);
  const customerId = text(object.customer);

  // async_payment_succeeded normaliza igual ao completed pago: com boleto ou Pix
  // — o caminho natural de um produto em reais — a sessão fecha unpaid e o
  // dinheiro chega dias depois, neste evento. Sem ele, o cliente paga e nunca é
  // creditado.
  if (payload.type === 'checkout.session.completed' || payload.type === 'checkout.session.async_payment_succeeded') {
    // Só o pagamento avulso interessa aqui: o checkout de assinatura já dispara
    // customer.subscription.created. Um caminho, uma verdade.
    if (object.mode !== 'payment') return { kind: 'ignored', reason: 'not a one-off payment' };
    if (object.payment_status !== 'paid') return { kind: 'ignored', reason: 'session not paid' };
    const sessionId = text(object.id);
    if (!sessionId) return { kind: 'ignored', reason: 'session without id' };
    // Sem o customer não há contra o que verificar o metadata, e creditar por
    // adivinhação é pior que não creditar.
    if (!customerId) return { kind: 'ignored', reason: 'session without customer' };
    return purchaseFrom(sessionId, customerId, asRecord(object.metadata));
  }

  if (payload.type === 'customer.subscription.created' || payload.type === 'customer.subscription.updated') {
    if (!customerId) return { kind: 'ignored', reason: 'subscription without customer' };
    return subscriptionFrom(customerId, object);
  }

  if (payload.type === 'customer.subscription.deleted') {
    if (!customerId) return { kind: 'ignored', reason: 'subscription without customer' };
    const subscriptionId = text(object.id);
    if (!subscriptionId) return { kind: 'ignored', reason: 'subscription without id' };
    return { kind: 'subscription-canceled', customerId, subscriptionId };
  }

  return { kind: 'ignored', reason: `unhandled type ${payload.type}` };
}

// O sync entrega o mesmo BillingEvent que o webhook entrega. Não é uma segunda
// implementação da regra; é outro jeito de entregar o mesmo evento.
export function eventFromSnapshot(customerId: string, snapshot: SubscriptionSnapshot): BillingEvent {
  return subscriptionFrom(customerId, {
    id: snapshot.subscriptionId,
    status: snapshot.status,
    metadata: snapshot.metadata,
    items: {
      data: [{ current_period_end: Math.floor(snapshot.currentPeriodEnd.getTime() / 1000), price: { id: snapshot.priceId } }],
    },
  });
}

export function eventFromPaidSession(session: PaidSession): BillingEvent {
  return purchaseFrom(session.sessionId, session.customerId, session.metadata);
}

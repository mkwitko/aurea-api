import { describe, expect, it } from 'vitest';
import { eventFromPaidSession, normalizeEvent, toSubscriptionStatus } from './stripe-event.js';

const SUB_PAYLOAD = {
  id: 'evt_1',
  type: 'customer.subscription.updated',
  object: {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    metadata: { organizationId: 'org-1', workspaceId: 'ws-1' },
    items: { data: [{ current_period_end: 1_790_000_000, price: { id: 'price_test_growth' } }] },
  },
};

describe('toSubscriptionStatus', () => {
  it('maps the paying states', () => {
    expect(toSubscriptionStatus('active')).toBe('ACTIVE');
    expect(toSubscriptionStatus('trialing')).toBe('ACTIVE');
  });

  it('maps the retry window', () => {
    expect(toSubscriptionStatus('past_due')).toBe('PAST_DUE');
    expect(toSubscriptionStatus('unpaid')).toBe('PAST_DUE');
  });

  it('fails closed on anything else', () => {
    expect(toSubscriptionStatus('incomplete')).toBe('CANCELED');
    expect(toSubscriptionStatus('something_new_stripe_invented')).toBe('CANCELED');
  });
});

describe('normalizeEvent', () => {
  it('turns a subscription update into state', () => {
    expect(normalizeEvent(SUB_PAYLOAD)).toEqual({
      kind: 'subscription-state',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      plan: 'GROWTH',
      status: 'ACTIVE',
      currentPeriodEnd: new Date(1_790_000_000 * 1000),
      workspaceId: 'ws-1',
    });
  });

  it('ignores a subscription on a price that is not ours', () => {
    const foreign = {
      ...SUB_PAYLOAD,
      object: { ...SUB_PAYLOAD.object, items: { data: [{ current_period_end: 1, price: { id: 'price_x' } }] } },
    };
    expect(normalizeEvent(foreign)).toMatchObject({ kind: 'ignored' });
  });

  it('turns a paid checkout session into a credit purchase', () => {
    const payload = {
      id: 'evt_2',
      type: 'checkout.session.completed',
      object: {
        id: 'cs_1',
        mode: 'payment',
        payment_status: 'paid',
        customer: 'cus_1',
        metadata: { organizationId: 'org-1', workspaceId: 'ws-1', packId: 'MEDIUM' },
      },
    };

    expect(normalizeEvent(payload)).toEqual({
      kind: 'credit-purchase',
      sourceId: 'cs_1',
      customerId: 'cus_1',
      organizationId: 'org-1',
      workspaceId: 'ws-1',
      packId: 'MEDIUM',
    });
  });

  // Sem o customer que pagou não há como verificar se a organização do metadata
  // é dona dele — e metadata é entrada não confiável (spec §10).
  it('ignores a paid session with no customer to verify the metadata against', () => {
    const payload = {
      id: 'evt_2b',
      type: 'checkout.session.completed',
      object: {
        id: 'cs_1b',
        mode: 'payment',
        payment_status: 'paid',
        metadata: { organizationId: 'org-1', workspaceId: 'ws-1', packId: 'MEDIUM' },
      },
    };
    expect(normalizeEvent(payload)).toMatchObject({ kind: 'ignored' });
  });

  it('ignores a subscription-mode checkout: the subscription event already says it', () => {
    const payload = {
      id: 'evt_3',
      type: 'checkout.session.completed',
      object: { id: 'cs_2', mode: 'subscription', payment_status: 'paid', metadata: {} },
    };
    expect(normalizeEvent(payload)).toMatchObject({ kind: 'ignored' });
  });

  it('ignores a pack id it does not know', () => {
    const payload = {
      id: 'evt_4',
      type: 'checkout.session.completed',
      object: {
        id: 'cs_3',
        mode: 'payment',
        payment_status: 'paid',
        metadata: { organizationId: 'org-1', workspaceId: 'ws-1', packId: 'HUGE' },
      },
    };
    expect(normalizeEvent(payload)).toMatchObject({ kind: 'ignored' });
  });

  it('turns a deletion into a cancellation', () => {
    const payload = {
      id: 'evt_5',
      type: 'customer.subscription.deleted',
      object: { id: 'sub_1', customer: 'cus_1' },
    };
    // O id da assinatura que morreu vem junto: sem ele, um deleted atrasado de
    // uma assinatura antiga cancela a assinatura nova de um cliente pagante.
    expect(normalizeEvent(payload)).toEqual({
      kind: 'subscription-canceled',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
    });
  });

  // Boleto e Pix — o caminho natural de um produto em reais — fecham a sessão
  // como unpaid e só depois o dinheiro entra, num
  // checkout.session.async_payment_succeeded. Sem tratá-lo, o cliente paga e
  // nunca é creditado.
  it('credits an asynchronous payment that succeeded after the session closed', () => {
    const payload = {
      id: 'evt_async',
      type: 'checkout.session.async_payment_succeeded',
      object: {
        id: 'cs_async',
        mode: 'payment',
        payment_status: 'paid',
        customer: 'cus_1',
        metadata: { organizationId: 'org-1', workspaceId: 'ws-1', packId: 'SMALL' },
      },
    };

    expect(normalizeEvent(payload)).toEqual({
      kind: 'credit-purchase',
      sourceId: 'cs_async',
      customerId: 'cus_1',
      organizationId: 'org-1',
      workspaceId: 'ws-1',
      packId: 'SMALL',
    });
  });

  it('ignores a session that closed without being paid', () => {
    const payload = {
      id: 'evt_unpaid',
      type: 'checkout.session.completed',
      object: {
        id: 'cs_unpaid',
        mode: 'payment',
        payment_status: 'unpaid',
        customer: 'cus_1',
        metadata: { organizationId: 'org-1', workspaceId: 'ws-1', packId: 'SMALL' },
      },
    };
    expect(normalizeEvent(payload)).toMatchObject({ kind: 'ignored' });
  });

  // Um payload malformado tem que degradar para 'ignored'. No webhook, um
  // TypeError vira 500 num evento que nunca vai conseguir passar: uma pílula
  // envenenada que o Stripe reentrega por três dias.
  it('degrades to ignored when the subscription item has no price object', () => {
    const broken = {
      ...SUB_PAYLOAD,
      object: { ...SUB_PAYLOAD.object, items: { data: [{ current_period_end: 1, price: null }] } },
    };
    expect(normalizeEvent(broken)).toMatchObject({ kind: 'ignored' });
  });

  it('degrades to ignored when the subscription item is not an object', () => {
    const broken = { ...SUB_PAYLOAD, object: { ...SUB_PAYLOAD.object, items: { data: ['nope'] } } };
    expect(normalizeEvent(broken)).toMatchObject({ kind: 'ignored' });
  });

  it('degrades to ignored when the period end is not a number', () => {
    const broken = {
      ...SUB_PAYLOAD,
      object: { ...SUB_PAYLOAD.object, items: { data: [{ current_period_end: null, price: { id: 'price_test_growth' } }] } },
    };
    expect(normalizeEvent(broken)).toMatchObject({ kind: 'ignored' });
  });

  it('degrades to ignored when the event object is not an object at all', () => {
    expect(normalizeEvent({ id: 'evt_x', type: 'customer.subscription.updated', object: 'nonsense' })).toMatchObject({
      kind: 'ignored',
    });
  });

  it('ignores an event type it does not handle', () => {
    expect(normalizeEvent({ id: 'evt_6', type: 'invoice.paid', object: {} })).toMatchObject({ kind: 'ignored' });
  });
});

describe('eventFromPaidSession', () => {
  it('produces the same purchase event the webhook produces', () => {
    expect(
      eventFromPaidSession({
        sessionId: 'cs_1',
        customerId: 'cus_1',
        metadata: { organizationId: 'org-1', workspaceId: 'ws-1', packId: 'SMALL' },
      }),
    ).toEqual({
      kind: 'credit-purchase',
      sourceId: 'cs_1',
      customerId: 'cus_1',
      organizationId: 'org-1',
      workspaceId: 'ws-1',
      packId: 'SMALL',
    });
  });
});

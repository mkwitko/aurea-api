import { describe, expect, it, vi } from 'vitest';

// A chave entra antes dos imports porque src/config/env.ts valida no import: sem
// ela, createStripeClient lança BILLING_NOT_CONFIGURED e não há o que testar.
// Valor de fachada — nenhum teste desta suíte toca a rede, a SDK é um fake.
const sdk = vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  return {
    search: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn().mockResolvedValue({ id: 'cus_created' }),
    retrieve: vi.fn(),
    update: vi.fn(),
  };
});

vi.mock('stripe', () => {
  class FakeStripe {
    customers = { search: sdk.search, create: sdk.create };
    subscriptions = { retrieve: sdk.retrieve, update: sdk.update };
    static errors = { StripeSignatureVerificationError: class extends Error {} };
  }
  return { default: FakeStripe };
});

const { createStripeClient, toSubscriptionSnapshot } = await import('./stripe-client.js');

// current_period_end saiu da Subscription e vive no SubscriptionItem desde as
// versões recentes da API. Ler do lugar errado devolve undefined e grava um
// currentPeriodEnd inválido — este teste é o que trava esse erro.
const RAW = {
  id: 'sub_123',
  status: 'active',
  metadata: { organizationId: 'org-1', workspaceId: 'ws-1' },
  items: {
    data: [{ current_period_end: 1_790_000_000, price: { id: 'price_test_growth' } }],
  },
};

describe('toSubscriptionSnapshot', () => {
  it('reads the price and the period end off the subscription item', () => {
    expect(toSubscriptionSnapshot(RAW)).toEqual({
      subscriptionId: 'sub_123',
      priceId: 'price_test_growth',
      status: 'active',
      currentPeriodEnd: new Date(1_790_000_000 * 1000),
      metadata: { organizationId: 'org-1', workspaceId: 'ws-1' },
    });
  });

  it('refuses a subscription with no item', () => {
    expect(() => toSubscriptionSnapshot({ ...RAW, items: { data: [] } })).toThrow();
  });
});

describe('ensureCustomer', () => {
  // A Search API do Stripe é eventualmente consistente (até ~1 minuto): dois
  // cliques em Assinar não se veem, e sem chave de idempotência nascem dois
  // Customers para a mesma organização — um deles órfão, e um pagamento nele
  // vira um evento que o banco não sabe resolver.
  it('creates the customer under an idempotency key derived from the organization', async () => {
    sdk.create.mockClear();
    const client = createStripeClient();

    await client.ensureCustomer({ organizationId: 'org-1', email: 'owner@acme.com', name: 'Acme' });

    expect(sdk.create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { organizationId: 'org-1' } }),
      { idempotencyKey: 'customer:org-1' },
    );
  });

  it('escapes the organization id it interpolates into the search query', async () => {
    sdk.search.mockClear();
    const client = createStripeClient();

    await client.ensureCustomer({ organizationId: "org'1", email: 'owner@acme.com', name: 'Acme' });

    expect(sdk.search).toHaveBeenCalledWith(
      expect.objectContaining({ query: "metadata['organizationId']:'org\\'1'" }),
    );
  });
});

describe('changeSubscriptionPlan', () => {
  // Troca de verdade: pega o item que já existe e troca o price DELE, em vez
  // de criar uma segunda Checkout Session (que só sabe criar assinatura nova).
  it('updates the existing item with the new price and proration enabled', async () => {
    sdk.retrieve.mockResolvedValue({
      id: 'sub_123',
      items: { data: [{ id: 'si_1', price: { id: 'price_test_growth' } }] },
    });
    sdk.update.mockResolvedValue({
      id: 'sub_123',
      status: 'active',
      metadata: { organizationId: 'org-1', workspaceId: 'ws-1' },
      items: { data: [{ current_period_end: 1_790_000_000, price: { id: 'price_test_scale' } }] },
    });
    const client = createStripeClient();

    const snapshot = await client.changeSubscriptionPlan({ subscriptionId: 'sub_123', priceId: 'price_test_scale' });

    expect(sdk.retrieve).toHaveBeenCalledWith('sub_123');
    expect(sdk.update).toHaveBeenCalledWith('sub_123', {
      items: [{ id: 'si_1', price: 'price_test_scale' }],
      proration_behavior: 'create_prorations',
    });
    expect(snapshot).toEqual({
      subscriptionId: 'sub_123',
      priceId: 'price_test_scale',
      status: 'active',
      currentPeriodEnd: new Date(1_790_000_000 * 1000),
      metadata: { organizationId: 'org-1', workspaceId: 'ws-1' },
    });
  });

  it('refuses a subscription with no item', async () => {
    sdk.update.mockClear();
    sdk.retrieve.mockResolvedValue({ id: 'sub_123', items: { data: [] } });
    const client = createStripeClient();

    await expect(
      client.changeSubscriptionPlan({ subscriptionId: 'sub_123', priceId: 'price_test_scale' }),
    ).rejects.toThrow();
    expect(sdk.update).not.toHaveBeenCalled();
  });
});

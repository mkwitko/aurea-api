import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { env } from '../../../config/env.js';
import { AppError } from '../../../lib/errors.js';
import type { OrgBilling } from '../../../billing/billing.repository.js';
import { getBillingRoute } from './get-billing/get-billing.controller.js';
import { createSubscriptionCheckoutRoute } from './create-subscription-checkout/create-subscription-checkout.controller.js';
import { createCreditPackCheckoutRoute } from './create-credit-pack-checkout/create-credit-pack-checkout.controller.js';
import { createPortalRoute } from './create-portal/create-portal.controller.js';
import { syncBillingRoute } from './sync-billing/sync-billing.controller.js';
import { getPlansRoute } from './get-plans/get-plans.controller.js';
import { changeSubscriptionPlanRoute } from './change-subscription-plan/change-subscription-plan.controller.js';

const ORG: OrgBilling = {
  id: 'org-1',
  name: 'Acme',
  plan: 'GROWTH',
  subscriptionStatus: 'ACTIVE',
  stripeCustomerId: 'cus_1',
  stripeSubscriptionId: 'sub_1',
  currentPeriodEnd: new Date('2026-08-01T00:00:00Z'),
  lastSyncedAt: null,
};

// organization.findUnique/update precisam ser stateful (não dois mocks presos
// no mesmo valor fixo): a rota de troca de plano lê o estado de volta depois
// de escrevê-lo, e "o OWNER recebe o plano novo na resposta" só prova alguma
// coisa se o update de um afetar a leitura do outro.
function prismaFake(orgOverrides: Partial<OrgBilling> = {}) {
  let org = { ...ORG, ...orgOverrides };
  return {
    organization: {
      findUnique: vi.fn(async () => org),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        org = { ...org, ...data } as typeof org;
        return org;
      }),
    },
    workspace: { count: vi.fn().mockResolvedValue(2) },
    user: { findUnique: vi.fn().mockResolvedValue({ email: 'owner@acme.com' }) },
    // Fake mínimo para o caminho de crédito da troca de plano: lockOpenPeriod
    // sempre lê "nenhum período aberto" (linha vazia), então
    // subscription.service.grantPlanChange devolve cedo sem tocar o ledger. A
    // matemática do delta (upgrade concede a diferença, downgrade não concede
    // nada, o grant acontece uma vez só) já é provada contra fakes de período
    // de verdade em checkout.service.test.ts e subscription.service.test.ts;
    // aqui só interessa que a rota persiste o plano novo e responde com ele.
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ $queryRaw: vi.fn().mockResolvedValue([]) })),
  };
}

const stripeFake = {
  ensureCustomer: vi.fn().mockResolvedValue('cus_1'),
  createSubscriptionCheckout: vi.fn().mockResolvedValue({ url: 'https://checkout/sub' }),
  createPackCheckout: vi.fn().mockResolvedValue({ url: 'https://checkout/pack' }),
  createPortalSession: vi.fn().mockResolvedValue({ url: 'https://portal' }),
  fetchSubscription: vi.fn().mockResolvedValue(null),
  listRecentPaidSessions: vi.fn().mockResolvedValue([]),
  constructEvent: vi.fn(),
  // Devolve o snapshot refletindo o price que a rota pediu, para o teste poder
  // escolher qualquer plano-alvo sem precisar de um mock por plano.
  changeSubscriptionPlan: vi.fn(async (input: { subscriptionId: string; priceId: string }) => ({
    subscriptionId: input.subscriptionId,
    priceId: input.priceId,
    status: 'active',
    currentPeriodEnd: new Date('2026-08-01T00:00:00Z'),
    metadata: { organizationId: 'org-1', workspaceId: 'ws-1' },
  })),
};

beforeEach(() => {
  vi.clearAllMocks();
});

async function buildTestApp(
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' = 'OWNER',
  orgOverrides: Partial<OrgBilling> = {},
) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prismaFake(orgOverrides) as never);
  app.decorate('stripe', () => stripeFake as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: 'ws-1', role };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
    throw error;
  });
  await app.register(getBillingRoute);
  await app.register(getPlansRoute);
  await app.register(createSubscriptionCheckoutRoute);
  await app.register(createCreditPackCheckoutRoute);
  await app.register(createPortalRoute);
  await app.register(syncBillingRoute);
  await app.register(changeSubscriptionPlanRoute);
  return app;
}

describe('GET /billing', () => {
  it('reports the plan, the status and the workspace cap', async () => {
    const res = await (await buildTestApp('VIEWER')).inject({ method: 'GET', url: '/billing' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      plan: 'GROWTH',
      status: 'ACTIVE',
      hasSubscription: true,
      maxWorkspaces: 3,
      workspaceCount: 2,
      currentPeriodEnd: '2026-08-01T00:00:00.000Z',
    });
  });

  it('never leaks money', async () => {
    const res = await (await buildTestApp()).inject({ method: 'GET', url: '/billing' });
    expect(res.payload).not.toMatch(/amount|price|brl|R\$/i);
  });
});

describe('POST /billing/checkout/subscription', () => {
  it('gives an OWNER a checkout url', async () => {
    const res = await (await buildTestApp('OWNER')).inject({
      method: 'POST',
      url: '/billing/checkout/subscription',
      payload: { plan: 'GROWTH' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ url: 'https://checkout/sub' });
  });

  it('refuses an ADMIN', async () => {
    const res = await (await buildTestApp('ADMIN')).inject({
      method: 'POST',
      url: '/billing/checkout/subscription',
      payload: { plan: 'GROWTH' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a plan that does not exist', async () => {
    const res = await (await buildTestApp('OWNER')).inject({
      method: 'POST',
      url: '/billing/checkout/subscription',
      payload: { plan: 'ENTERPRISE' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /billing/checkout/credits', () => {
  it('lets an ADMIN buy a pack', async () => {
    const res = await (await buildTestApp('ADMIN')).inject({
      method: 'POST',
      url: '/billing/checkout/credits',
      payload: { packId: 'MEDIUM' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ url: 'https://checkout/pack' });
  });

  it('refuses a MEMBER', async () => {
    const res = await (await buildTestApp('MEMBER')).inject({
      method: 'POST',
      url: '/billing/checkout/credits',
      payload: { packId: 'MEDIUM' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a pack that does not exist', async () => {
    const res = await (await buildTestApp('OWNER')).inject({
      method: 'POST',
      url: '/billing/checkout/credits',
      payload: { packId: 'HUGE' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /billing/portal', () => {
  it('gives an OWNER a portal url', async () => {
    const res = await (await buildTestApp('OWNER')).inject({ method: 'POST', url: '/billing/portal' });
    expect(res.json()).toEqual({ url: 'https://portal' });
  });

  it('refuses an ADMIN', async () => {
    const res = await (await buildTestApp('ADMIN')).inject({ method: 'POST', url: '/billing/portal' });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /billing/sync', () => {
  it('answers with the same shape as GET /billing', async () => {
    const res = await (await buildTestApp('ADMIN')).inject({ method: 'POST', url: '/billing/sync' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ plan: 'GROWTH', status: 'ACTIVE', maxWorkspaces: 3 });
  });

  it('refuses a VIEWER', async () => {
    const res = await (await buildTestApp('VIEWER')).inject({ method: 'POST', url: '/billing/sync' });
    expect(res.statusCode).toBe(403);
  });
});

// Achado crítico: "trocar de plano" não é uma segunda Checkout Session — essa
// só CRIA assinatura, e reabri-la numa organização ACTIVE deixava o cliente
// pagando as duas ao mesmo tempo. Esta rota chama subscriptions.update com
// proração e aplica o resultado pelo mesmo caminho do webhook.
describe('POST /billing/subscription/plan', () => {
  it('lets an OWNER change the plan and returns the refreshed billing state', async () => {
    const res = await (await buildTestApp('OWNER')).inject({
      method: 'POST',
      url: '/billing/subscription/plan',
      payload: { plan: 'SCALE' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ plan: 'SCALE', status: 'ACTIVE', maxWorkspaces: 10 });
  });

  it('refuses an ADMIN with the same status the other owner-only route uses', async () => {
    const res = await (await buildTestApp('ADMIN')).inject({
      method: 'POST',
      url: '/billing/subscription/plan',
      payload: { plan: 'SCALE' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses a MEMBER', async () => {
    const res = await (await buildTestApp('MEMBER')).inject({
      method: 'POST',
      url: '/billing/subscription/plan',
      payload: { plan: 'SCALE' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses a VIEWER', async () => {
    const res = await (await buildTestApp('VIEWER')).inject({
      method: 'POST',
      url: '/billing/subscription/plan',
      payload: { plan: 'SCALE' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses an organization with no subscription to change, and never calls stripe', async () => {
    const app = await buildTestApp('OWNER', { stripeSubscriptionId: null });
    const res = await app.inject({
      method: 'POST',
      url: '/billing/subscription/plan',
      payload: { plan: 'SCALE' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'AUR-T0019' } });
    expect(stripeFake.changeSubscriptionPlan).not.toHaveBeenCalled();
  });

  it('refuses a CANCELED organization the same way', async () => {
    const app = await buildTestApp('OWNER', { subscriptionStatus: 'CANCELED' });
    const res = await app.inject({
      method: 'POST',
      url: '/billing/subscription/plan',
      payload: { plan: 'SCALE' },
    });

    expect(res.statusCode).toBe(409);
    expect(stripeFake.changeSubscriptionPlan).not.toHaveBeenCalled();
  });

  it('yields BILLING_NOT_CONFIGURED when the target plan price is missing', async () => {
    const mutable = env as { STRIPE_PRICE_SCALE?: string };
    const stored = mutable.STRIPE_PRICE_SCALE;
    mutable.STRIPE_PRICE_SCALE = undefined;
    try {
      const app = await buildTestApp('OWNER');
      const res = await app.inject({
        method: 'POST',
        url: '/billing/subscription/plan',
        payload: { plan: 'SCALE' },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toMatchObject({ error: { code: 'AUR-T0016' } });
      expect(stripeFake.changeSubscriptionPlan).not.toHaveBeenCalled();
    } finally {
      mutable.STRIPE_PRICE_SCALE = stored;
    }
  });
});

describe('GET /billing/plans', () => {
  it('publishes the catalog to any member, VIEWER included', async () => {
    const res = await (await buildTestApp('VIEWER')).inject({ method: 'GET', url: '/billing/plans' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      plans: [
        { plan: 'STARTER', monthlyCredits: 200, maxWorkspaces: 1, priceCents: 29_700, currency: 'BRL' },
        { plan: 'GROWTH', monthlyCredits: 1_000, maxWorkspaces: 3, priceCents: 99_700, currency: 'BRL' },
        { plan: 'SCALE', monthlyCredits: 4_000, maxWorkspaces: 10, priceCents: 249_700, currency: 'BRL' },
      ],
      packs: [
        { packId: 'SMALL', credits: 100, priceCents: 19_700, currency: 'BRL' },
        { packId: 'MEDIUM', credits: 500, priceCents: 79_700, currency: 'BRL' },
        { packId: 'LARGE', credits: 2_000, priceCents: 249_700, currency: 'BRL' },
      ],
    });
  });

  it('does not touch Stripe or the database', async () => {
    const app = await buildTestApp('MEMBER');
    await app.inject({ method: 'GET', url: '/billing/plans' });

    expect(stripeFake.ensureCustomer).not.toHaveBeenCalled();
    expect(stripeFake.fetchSubscription).not.toHaveBeenCalled();
    expect(app.prisma.organization.findUnique).not.toHaveBeenCalled();
    expect(app.prisma.workspace.count).not.toHaveBeenCalled();
    expect(app.prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

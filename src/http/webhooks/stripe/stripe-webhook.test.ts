import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { stripeWebhookRoute } from './stripe-webhook.controller.js';
import { WebhookSignatureError } from '../../../billing/stripe-client.js';

const PAID_SESSION = {
  id: 'cs_1',
  mode: 'payment',
  payment_status: 'paid',
  customer: 'cus_1',
  metadata: { organizationId: 'org-1', workspaceId: 'ws-1', packId: 'SMALL' },
};

function prismaFake(processed: string[] = []) {
  return {
    stripeEvent: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        processed.includes(where.id) ? { id: where.id } : null,
      ),
    },
    organization: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
    workspace: { count: vi.fn().mockResolvedValue(1) },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $transaction: vi.fn(),
  };
}

async function buildTestApp(options: {
  constructEvent?: () => unknown;
  apply?: () => Promise<'applied' | 'ignored' | 'unresolved'>;
  processed?: string[];
}) {
  const app = Fastify();
  const prisma = prismaFake(options.processed);
  app.decorate('prisma', prisma as never);
  app.decorate('stripe', () => ({
    constructEvent:
      options.constructEvent ??
      (() => ({ id: 'evt_1', type: 'checkout.session.completed', object: PAID_SESSION })),
  }) as never);
  const apply = vi.fn(options.apply ?? (async () => 'applied' as const));
  app.decorate('subscriptionsOverride', { apply } as never);
  await app.register(stripeWebhookRoute);
  return { app, apply, prisma };
}

function post(app: Awaited<ReturnType<typeof buildTestApp>>['app'], signature = 't=1,v1=deadbeef') {
  return app.inject({
    method: 'POST',
    url: '/webhooks/stripe',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    payload: JSON.stringify({ hello: 'world' }),
  });
}

describe('POST /webhooks/stripe', () => {
  it('applies a verified event and answers 200', async () => {
    const { app, apply } = await buildTestApp({});

    const res = await post(app);

    expect(res.statusCode).toBe(200);
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ kind: 'credit-purchase' }), expect.any(Date));
  });

  it('answers 400 and applies nothing when the signature is invalid', async () => {
    const { app, apply, prisma } = await buildTestApp({
      constructEvent: () => {
        throw new WebhookSignatureError('No signatures found matching the expected signature for payload');
      },
    });

    const res = await post(app);

    expect(res.statusCode).toBe(400);
    expect(apply).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('answers 500, not 400, when constructEvent fails for a reason other than a bad signature', async () => {
    // Um JSON.parse corrompido depois de assinatura válida (ou qualquer outro
    // bug do SDK) não é ataque: é nosso, e precisa aparecer como 500 no painel
    // do Stripe, não se disfarçar de "assinatura rejeitada".
    const { app, apply, prisma } = await buildTestApp({
      constructEvent: () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    });

    const res = await post(app);

    expect(res.statusCode).toBe(500);
    expect(apply).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('answers 400 when the signature header is missing', async () => {
    const { app } = await buildTestApp({});
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });

    expect(res.statusCode).toBe(400);
  });

  it('short-circuits a redelivery of an event it already processed', async () => {
    const { app, apply } = await buildTestApp({ processed: ['evt_1'] });

    const res = await post(app);

    expect(res.statusCode).toBe(200);
    expect(apply).not.toHaveBeenCalled();
  });

  it('leaves no processed mark when the handler throws, so stripe retries', async () => {
    const { app, prisma } = await buildTestApp({
      apply: async () => {
        throw new Error('database is on fire');
      },
    });

    const res = await post(app);

    expect(res.statusCode).toBe(500);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  // "Não é meu" e "ainda não sei de quem é" não podem ter o mesmo destino.
  // Marcar o segundo como processado descarta a janela de retry do Stripe, que é
  // a única recuperação automática de um pagamento que chegou e não foi
  // creditado — é o que transformava a corrida do Customer num pagamento perdido.
  it('leaves no processed mark and answers 500 when the event could not be resolved', async () => {
    const { app, prisma } = await buildTestApp({ apply: async () => 'unresolved' });

    const res = await post(app);

    expect(res.statusCode).toBe(500);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('marks an event it deliberately ignored as processed, so stripe stops resending it', async () => {
    const { app, prisma } = await buildTestApp({ apply: async () => 'ignored' });

    const res = await post(app);

    expect(res.statusCode).toBe(200);
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('never echoes the event body back', async () => {
    const { app } = await buildTestApp({});
    const res = await post(app);

    expect(res.payload).not.toContain('cus_1');
    expect(res.payload).not.toContain('packId');
  });

  it('does not leak its raw-body parser to an ordinary JSON route on the same app', async () => {
    const { app } = await buildTestApp({});

    // Rota comum registrada depois, no mesmo app: se o parser cru vazasse do
    // escopo do plugin do webhook, este body chegaria como Buffer, não objeto.
    app.post('/ordinary', async (req) => ({ received: req.body }));

    const res = await app.inject({
      method: 'POST',
      url: '/ordinary',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ hello: 'world' }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: { hello: 'world' } });
  });
});

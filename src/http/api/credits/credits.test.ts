import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { getCreditsRoute } from './get-credits/get-credits.controller.js';
import { listLedgerRoute } from './list-ledger/list-ledger.controller.js';
import { getPricingRoute } from './get-pricing/get-pricing.controller.js';

const PERIOD = new Date('2026-07-01T00:00:00Z');

function prismaFake() {
  return {
    workspace: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ organization: { plan: 'STARTER', subscriptionStatus: 'ACTIVE' } }),
    },
    creditPeriod: {
      findUnique: vi.fn().mockResolvedValue({ id: 'p-1', periodStart: PERIOD, allowance: 200, consumed: 12 }),
    },
    creditLedger: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'l-1',
          kind: 'DEBIT',
          credits: -1,
          agentRunId: 'run-1',
          reason: 'agent run run-1',
          createdAt: new Date('2026-07-10T00:00:00Z'),
        },
      ]),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ balance: 30 }]),
  };
}

async function buildTestApp(role: 'OWNER' | 'VIEWER' = 'OWNER') {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prismaFake() as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'o1', workspaceId: 'ws-1', role };
  });
  await app.register(getCreditsRoute);
  await app.register(listLedgerRoute);
  await app.register(getPricingRoute);
  return app;
}

describe('credits routes', () => {
  it('reports plan, allowance and purchased balance', async () => {
    const app = await buildTestApp();

    const res = await app.inject({ method: 'GET', url: '/credits' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      plan: 'STARTER',
      allowance: 200,
      consumed: 12,
      purchasedBalance: 30,
    });
  });

  it('lets a VIEWER read the balance', async () => {
    const app = await buildTestApp('VIEWER');
    expect((await app.inject({ method: 'GET', url: '/credits' })).statusCode).toBe(200);
  });

  it('returns the ledger newest first', async () => {
    const app = await buildTestApp();

    const res = await app.inject({ method: 'GET', url: '/credits/ledger' });

    expect(res.statusCode).toBe(200);
    expect(res.json().entries[0]).toMatchObject({ kind: 'DEBIT', credits: -1 });
  });

  it('rejects a bad cursor', async () => {
    const app = await buildTestApp();
    expect((await app.inject({ method: 'GET', url: '/credits/ledger?before=notadate' })).statusCode).toBe(400);
  });

  it('publishes what each action costs in credits', async () => {
    const app = await buildTestApp();

    const res = await app.inject({ method: 'GET', url: '/credits/pricing' });

    expect(res.statusCode).toBe(200);
    expect(res.json().operations).toContainEqual({ taskType: 'summarize-business-context', credits: 1 });
  });

  it('never leaks money or tokens to the client', async () => {
    const app = await buildTestApp();

    for (const url of ['/credits', '/credits/ledger', '/credits/pricing']) {
      const payload = (await app.inject({ method: 'GET', url })).payload;
      expect(payload).not.toMatch(/estimatedCost|inputTokens|outputTokens|pricePerMTok/);
    }
  });
});

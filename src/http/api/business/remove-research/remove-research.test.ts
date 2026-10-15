import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../../lib/errors.js';
import { removeResearchRoute } from './remove-research.controller.js';

const RUN_ID = '11111111-1111-1111-1111-111111111111';
const GOAL_ID = '22222222-2222-2222-2222-222222222222';
const BUSINESS_ID = '33333333-3333-3333-3333-333333333333';
const VERSION_ID = '44444444-4444-4444-4444-444444444444';

const finding = (overrides = {}) => ({
  dimension: 'MARKET',
  statement: 'Demand for ops tooling grew through 2026.',
  evidence: 'Search interest rose 40%.',
  sourceUrl: 'https://example.test/report',
  sourceTitle: 'State of Ops 2026',
  confidence: 'MEDIUM',
  target: 'TREND',
  ...overrides,
});

const RUN = {
  id: RUN_ID,
  workspaceId: 'ws-1',
  taskType: 'research-growth-context',
  status: 'COMPLETED',
  input: { goalId: GOAL_ID },
  output: {
    summary: 'The market is growing.',
    findings: [
      finding(),
      finding({ target: 'NONE', statement: 'Interesting but unfiled.' }),
      finding({
        target: 'COMPETITOR',
        statement: 'Northwind bundles onboarding.',
        competitor: { name: 'Northwind', strengths: [], weaknesses: [] },
      }),
    ],
    opportunities: [
      { statement: 'Own the search demand.', rationale: 'High intent.', supportingFindings: [0], confidence: 'LOW' },
    ],
  },
};

/** Contexto com o achado 0, o concorrente do achado 2 e a oportunidade 0 guardados. */
const CONTEXT = {
  id: 'ctx-1',
  currentVersionId: VERSION_ID,
  currentVersion: {
    id: VERSION_ID,
    version: 3,
    data: {
      marketContext: {
        trends: ['Demand for ops tooling grew through 2026.', 'Written by hand.'],
        opportunities: ['Own the search demand.'],
      },
      competitiveLandscape: { competitors: [{ name: 'Northwind' }, { name: 'Rival' }] },
    },
    source: 'RESEARCH',
    confidence: 'HIGH',
    sourceAgentRunId: RUN_ID,
    createdAt: new Date(),
  },
};

const create = vi.fn();

function prismaFake(overrides: { run?: unknown; business?: unknown; context?: unknown } = {}) {
  const run = 'run' in overrides ? overrides.run : RUN;
  const business = 'business' in overrides ? overrides.business : { id: BUSINESS_ID, workspaceId: 'ws-1' };
  const context = 'context' in overrides ? overrides.context : CONTEXT;
  const fake = {
    agentRun: { findFirst: vi.fn().mockResolvedValue(run) },
    business: { findFirst: vi.fn().mockResolvedValue(business) },
    businessContext: {
      findUnique: vi.fn().mockResolvedValue(context),
      upsert: vi.fn().mockResolvedValue({ id: 'ctx-1', currentVersionId: VERSION_ID }),
      update: vi.fn().mockResolvedValue({}),
    },
    businessContextVersion: {
      count: vi.fn().mockResolvedValue(3),
      update: vi.fn().mockResolvedValue({}),
      create: create.mockResolvedValue({
        id: '55555555-5555-5555-5555-555555555555',
        version: 4,
        data: {},
        source: 'USER',
        confidence: 'HIGH',
        sourceAgentRunId: null,
        createdAt: new Date(),
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(fake)),
  };
  return fake;
}

beforeEach(() => vi.clearAllMocks());

async function buildApp(overrides: { run?: unknown; business?: unknown; context?: unknown } = {}) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prismaFake(overrides) as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: 'ws-1', role: 'MEMBER' };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
    throw error;
  });
  await app.register(removeResearchRoute);
  return app;
}

const remove = (app: Awaited<ReturnType<typeof buildApp>>, payload: Record<string, unknown>) =>
  app.inject({ method: 'DELETE', url: '/business/context/from-research', payload });

describe('DELETE /business/context/from-research', () => {
  it('takes the accepted trend back out and leaves the hand-written one', async () => {
    const app = await buildApp();

    const res = await remove(app, { agentRunId: RUN_ID, findingIndexes: [0] });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ created: true, skippedFindingIndexes: [] });
    const written = create.mock.calls[0]![0]!.data as { data: { marketContext: { trends: string[] } } };
    expect(written.data.marketContext.trends).toEqual(['Written by hand.']);
  });

  it('takes a competitor back out by name', async () => {
    const app = await buildApp();

    await remove(app, { agentRunId: RUN_ID, findingIndexes: [2] });

    const written = create.mock.calls[0]![0]!.data as {
      data: { competitiveLandscape: { competitors: { name: string }[] } };
    };
    expect(written.data.competitiveLandscape.competitors).toEqual([{ name: 'Rival' }]);
  });

  it('takes an opportunity back out', async () => {
    const app = await buildApp();

    await remove(app, { agentRunId: RUN_ID, opportunityIndexes: [0] });

    const written = create.mock.calls[0]![0]!.data as { data: { marketContext: { opportunities: string[] } } };
    expect(written.data.marketContext.opportunities).toEqual([]);
  });

  // Quem decidiu remover foi a pessoa, então a versão é USER. E a confiança da
  // versão anterior é preservada: tirar uma linha não muda o quanto o resto do
  // contexto é sustentado.
  it('records the removal as a human decision and keeps the previous confidence', async () => {
    const app = await buildApp();

    await remove(app, { agentRunId: RUN_ID, findingIndexes: [0] });

    expect(create.mock.calls[0]![0]!.data).toMatchObject({ source: 'USER', confidence: 'HIGH' });
  });

  it('creates no version when what was asked to be removed is not in the context', async () => {
    const app = await buildApp({ context: null });

    const res = await remove(app, { agentRunId: RUN_ID, findingIndexes: [0] });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ created: false, version: null, skippedFindingIndexes: [0] });
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses the NONE-target finding, which was never filed anywhere', async () => {
    const app = await buildApp();

    expect((await remove(app, { agentRunId: RUN_ID, findingIndexes: [1] })).statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses an empty selection', async () => {
    const app = await buildApp();

    expect((await remove(app, { agentRunId: RUN_ID })).statusCode).toBe(400);
  });

  it('404s for a run in another workspace', async () => {
    const app = await buildApp({ run: null });

    expect((await remove(app, { agentRunId: RUN_ID, findingIndexes: [0] })).statusCode).toBe(404);
  });
});

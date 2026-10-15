import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../../lib/errors.js';
import { researchPresenceRoute } from './research-presence.controller.js';

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
    findings: [finding(), finding({ statement: 'Nobody accepted this one.' })],
    opportunities: [
      { statement: 'Own the search demand.', rationale: 'High intent.', supportingFindings: [0], confidence: 'LOW' },
    ],
  },
};

/** Um contexto onde o achado 0 e a oportunidade 0 já estão guardados. */
const CONTEXT = {
  id: 'ctx-1',
  currentVersionId: VERSION_ID,
  currentVersion: {
    id: VERSION_ID,
    version: 3,
    data: {
      marketContext: {
        trends: ['Demand for ops tooling grew through 2026.'],
        opportunities: ['Own the search demand.'],
      },
    },
    source: 'RESEARCH',
    confidence: 'MEDIUM',
    sourceAgentRunId: RUN_ID,
    createdAt: new Date(),
  },
};

function prismaFake(overrides: { run?: unknown; business?: unknown; context?: unknown } = {}) {
  const run = 'run' in overrides ? overrides.run : RUN;
  const business = 'business' in overrides ? overrides.business : { id: BUSINESS_ID, workspaceId: 'ws-1' };
  const context = 'context' in overrides ? overrides.context : CONTEXT;
  return {
    agentRun: { findFirst: vi.fn().mockResolvedValue(run) },
    business: { findFirst: vi.fn().mockResolvedValue(business) },
    businessContext: { findUnique: vi.fn().mockResolvedValue(context) },
  };
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
  await app.register(researchPresenceRoute);
  return app;
}

const get = (app: Awaited<ReturnType<typeof buildApp>>, runId = RUN_ID) =>
  app.inject({ method: 'GET', url: `/business/context/from-research/${runId}` });

describe('GET /business/context/from-research/:agentRunId', () => {
  // É isto que faz a revisão sobreviver a um F5: sem esta resposta a tela só
  // sabia o que ela mesma tinha acabado de salvar, e um recarregamento reabria
  // tudo como se nada tivesse sido guardado.
  it('reports which findings and opportunities of this run are already stored', async () => {
    const app = await buildApp();

    const res = await get(app);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ presentFindingIndexes: [0], presentOpportunityIndexes: [0] });
  });

  it('reports nothing stored when the workspace has no context yet', async () => {
    const app = await buildApp({ context: null });

    expect((await get(app)).json()).toEqual({ presentFindingIndexes: [], presentOpportunityIndexes: [] });
  });

  // Não ter negócio ainda não é um erro para esta pergunta: é a resposta "nada
  // está guardado". Um 404 aqui faria a tela de pesquisa mostrar um erro em vez
  // de uma revisão perfeitamente utilizável.
  it('reports nothing stored when the workspace has no business yet', async () => {
    const app = await buildApp({ business: null });

    const res = await get(app);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ presentFindingIndexes: [], presentOpportunityIndexes: [] });
  });

  it('404s for a run in another workspace', async () => {
    const app = await buildApp({ run: null });

    expect((await get(app)).statusCode).toBe(404);
  });

  it('refuses a run that did not produce research', async () => {
    const app = await buildApp({ run: { ...RUN, taskType: 'propose-strategies' } });

    expect((await get(app)).statusCode).toBe(400);
  });

  it('refuses a run that has not finished', async () => {
    const app = await buildApp({ run: { ...RUN, status: 'RUNNING' } });

    expect((await get(app)).statusCode).toBe(400);
  });
});

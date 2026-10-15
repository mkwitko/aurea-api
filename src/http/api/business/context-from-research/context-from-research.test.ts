import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../../lib/errors.js';
import { contextFromResearchRoute } from './context-from-research.controller.js';

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
    findings: [finding(), finding({ target: 'NONE', statement: 'Interesting but unfiled.' })],
    opportunities: [
      { statement: 'Own the search demand.', rationale: 'High intent.', supportingFindings: [0], confidence: 'LOW' },
    ],
  },
};

const create = vi.fn();

// `run` e `business` aceitam `null` de propósito (para os casos de 404/400),
// então a presença da chave é o sinal de override, não o valor.
function prismaFake(overrides: { run?: unknown; business?: unknown; context?: unknown } = {}) {
  const run = 'run' in overrides ? overrides.run : RUN;
  const business = 'business' in overrides ? overrides.business : { id: BUSINESS_ID, workspaceId: 'ws-1' };
  const context = 'context' in overrides ? overrides.context : null;
  const fake = {
    agentRun: { findFirst: vi.fn().mockResolvedValue(run) },
    business: { findFirst: vi.fn().mockResolvedValue(business) },
    businessContext: {
      findUnique: vi.fn().mockResolvedValue(context),
      upsert: vi.fn().mockResolvedValue({ id: 'ctx-1', currentVersionId: null }),
      update: vi.fn().mockResolvedValue({}),
    },
    businessContextVersion: {
      count: vi.fn().mockResolvedValue(0),
      // contextVersionResponse serializa contra contextVersionSchema, então o
      // valor resolvido precisa de todo campo obrigatório presente — como o
      // create-from-proposal irmão faz para strategyResponse.
      create: create.mockResolvedValue({
        id: VERSION_ID,
        version: 1,
        data: {},
        source: 'RESEARCH',
        confidence: 'MEDIUM',
        sourceAgentRunId: RUN_ID,
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
  await app.register(contextFromResearchRoute);
  return app;
}

async function post(app: Awaited<ReturnType<typeof buildApp>>, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/business/context/from-research', payload });
}

describe('POST /business/context/from-research', () => {
  it('accepting one finding responds 201 and writes it into the context data', async () => {
    const app = await buildApp();

    const res = await post(app, { agentRunId: RUN_ID, findingIndexes: [0] });

    expect(res.statusCode).toBe(201);
    const written = create.mock.calls[0]![0]!.data as { data: { marketContext: { trends: string[] } } };
    expect(written.data.marketContext.trends).toContain('Demand for ops tooling grew through 2026.');
  });

  it('records the source as RESEARCH and the run that produced it', async () => {
    const app = await buildApp();

    await post(app, { agentRunId: RUN_ID, findingIndexes: [0] });

    const written = create.mock.calls[0]![0]!.data as Record<string, unknown>;
    expect(written).toMatchObject({ source: 'RESEARCH', sourceAgentRunId: RUN_ID });
  });

  // Gravar a proveniência e não devolvê-la deixaria a promessa da §5 do spec
  // verdadeira no banco e inalcançável pelo produto: nada conseguiria voltar do
  // valor aceito para a citação e a url que o justificaram.
  it('returns the originating run id on the created version', async () => {
    const app = await buildApp();

    const res = await post(app, { agentRunId: RUN_ID, findingIndexes: [0] });

    expect(res.json().version.sourceAgentRunId).toBe(RUN_ID);
  });

  it('accepting the LOW opportunity together with the MEDIUM finding writes LOW confidence', async () => {
    const app = await buildApp();

    await post(app, { agentRunId: RUN_ID, findingIndexes: [0], opportunityIndexes: [0] });

    const written = create.mock.calls[0]![0]!.data as Record<string, unknown>;
    expect(written.confidence).toBe('LOW');
  });

  it('404s for a run in another workspace', async () => {
    const app = await buildApp({ run: null });

    const res = await post(app, { agentRunId: RUN_ID, findingIndexes: [0] });

    expect(res.statusCode).toBe(404);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a run that did not produce research', async () => {
    const app = await buildApp({ run: { ...RUN, taskType: 'propose-strategies' } });

    const res = await post(app, { agentRunId: RUN_ID, findingIndexes: [0] });

    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a run that has not finished', async () => {
    const app = await buildApp({ run: { ...RUN, status: 'RUNNING' } });

    const res = await post(app, { agentRunId: RUN_ID, findingIndexes: [0] });

    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a finding index outside the research', async () => {
    const app = await buildApp();

    const res = await post(app, { agentRunId: RUN_ID, findingIndexes: [7] });

    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses selecting the NONE-target finding', async () => {
    const app = await buildApp();

    const res = await post(app, { agentRunId: RUN_ID, findingIndexes: [1] });

    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a stored output that no longer parses as research', async () => {
    const app = await buildApp({ run: { ...RUN, output: { nonsense: true } } });

    const res = await post(app, { agentRunId: RUN_ID, findingIndexes: [0] });

    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses when there is no business in the workspace', async () => {
    const app = await buildApp({ business: null });

    const res = await post(app, { agentRunId: RUN_ID, findingIndexes: [0] });

    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  // A queixa que originou isto: o aceite de algo que já estava guardado
  // devolvia 201 com uma versão nova idêntica à anterior. A tela dizia "salvo",
  // o contexto não mudava, e o fundador concluía que salvar não funciona.
  it('creates no version when everything selected is already in the context, and says which', async () => {
    const app = await buildApp({
      context: {
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
          source: 'USER',
          confidence: 'MEDIUM',
          sourceAgentRunId: null,
          createdAt: new Date(),
        },
      },
    });

    const res = await post(app, { agentRunId: RUN_ID, findingIndexes: [0], opportunityIndexes: [0] });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      created: false,
      skippedFindingIndexes: [0],
      skippedOpportunityIndexes: [0],
    });
    // A versão devolvida é a atual, não uma nova.
    expect(res.json().version.version).toBe(3);
    expect(create).not.toHaveBeenCalled();
  });

  it('writes only what was missing when part of the selection is already there', async () => {
    const app = await buildApp({
      context: {
        id: 'ctx-1',
        currentVersionId: VERSION_ID,
        currentVersion: {
          id: VERSION_ID,
          version: 3,
          data: { marketContext: { trends: ['Demand for ops tooling grew through 2026.'] } },
          source: 'USER',
          confidence: 'MEDIUM',
          sourceAgentRunId: null,
          createdAt: new Date(),
        },
      },
    });

    const res = await post(app, { agentRunId: RUN_ID, findingIndexes: [0], opportunityIndexes: [0] });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ created: true, skippedFindingIndexes: [0], skippedOpportunityIndexes: [] });
    const written = create.mock.calls[0]![0]!.data as { data: { marketContext: Record<string, string[]> } };
    // O achado repetido não duplica, e a oportunidade nova entra.
    expect(written.data.marketContext.trends).toEqual(['Demand for ops tooling grew through 2026.']);
    expect(written.data.marketContext.opportunities).toEqual(['Own the search demand.']);
  });

  it('reports a plain accept as created, so the screen can trust the flag', async () => {
    const app = await buildApp();

    const res = await post(app, { agentRunId: RUN_ID, findingIndexes: [0] });

    expect(res.json()).toMatchObject({ created: true, skippedFindingIndexes: [], skippedOpportunityIndexes: [] });
  });

  it('refuses an empty selection', async () => {
    const app = await buildApp();

    const res = await post(app, { agentRunId: RUN_ID, findingIndexes: [], opportunityIndexes: [] });

    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});

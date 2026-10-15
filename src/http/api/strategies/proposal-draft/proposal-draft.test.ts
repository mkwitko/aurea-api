import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../../lib/errors.js';
import { proposalDraftRoute } from './proposal-draft.controller.js';

const RUN_ID = '11111111-1111-1111-1111-111111111111';
const GOAL_ID = '22222222-2222-2222-2222-222222222222';

const option = (name = 'Founder-led outbound') => ({
  name,
  strategicThesis: 'Ops leads answer a person.',
  growthMechanism: 'Outbound',
  expectedOutcome: 'Ten calls',
  channels: ['Email'],
  assumptions: ['They read email'],
  risks: ['Deliverability'],
  tradeoffs: 'Slower than paid.',
  // Duas: o schema do agente exige duas ou três hipóteses por opção.
  hypotheses: [
    {
      statement: 'Plain text wins',
      rationale: 'Templates read as marketing',
      targetMetric: 'reply_rate',
      expectedOutcome: 'Above 12%',
      confidence: 'MEDIUM',
    },
    {
      statement: 'Three touches beat one',
      rationale: 'One touch is missed, not refused',
      targetMetric: 'reply_rate',
      expectedOutcome: 'Above 15%',
      confidence: 'LOW',
    },
  ],
});

const RUN = {
  id: RUN_ID,
  workspaceId: 'ws-1',
  taskType: 'propose-strategies',
  status: 'COMPLETED',
  input: { goalId: GOAL_ID },
  output: { options: [option(), option('Content-led')], recommendedIndex: 0, rationale: 'Cheapest way to learn.' },
};

beforeEach(() => vi.clearAllMocks());

async function buildApp(run: unknown = RUN) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', { agentRun: { findFirst: vi.fn().mockResolvedValue(run) } } as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: 'ws-1', role: 'MEMBER' };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
    throw error;
  });
  await app.register(proposalDraftRoute);
  return app;
}

const get = (app: Awaited<ReturnType<typeof buildApp>>, query: string) =>
  app.inject({ method: 'GET', url: `/strategies/from-proposal/${RUN_ID}/draft?${query}` });

describe('GET /strategies/from-proposal/:agentRunId/draft', () => {
  // A tela precisa mostrar o texto combinado num formulário editável. Sem esta
  // rota, o browser recalcularia a fusão — uma segunda regra livre para
  // divergir da que grava.
  it('answers the plan that combining these options would produce', async () => {
    const app = await buildApp();

    const res = await get(app, 'optionIndexes=0,1');

    expect(res.statusCode).toBe(200);
    expect(res.json().strategy).toMatchObject({
      name: 'Founder-led outbound + Content-led',
      growthMechanism: 'Outbound',
      channels: ['Email'],
    });
    expect(res.json().strategy.hypotheses).toHaveLength(4);
  });

  // Uma opção sozinha cabe em qualquer limite; três opções cheias somam
  // 18 canais, 15 premissas e 15 riscos. Enquanto a resposta parava em 10, a
  // combinação legítima morria na serialização — 500, sem plano nenhum na tela.
  it('answers a combination as wide as three full options, without dropping lists', async () => {
    const wide = (prefix: string) => ({
      ...option(prefix),
      channels: Array.from({ length: 6 }, (_, i) => `${prefix} channel ${i}`),
      assumptions: Array.from({ length: 5 }, (_, i) => `${prefix} assumption ${i}`),
      risks: Array.from({ length: 5 }, (_, i) => `${prefix} risk ${i}`),
    });
    const app = await buildApp({
      ...RUN,
      output: { options: [wide('A'), wide('B'), wide('C')], recommendedIndex: 0, rationale: 'Widest case.' },
    });

    const res = await get(app, 'optionIndexes=0,1,2');

    expect(res.statusCode).toBe(200);
    expect(res.json().strategy.channels).toHaveLength(18);
    expect(res.json().strategy.assumptions).toHaveLength(15);
    expect(res.json().strategy.risks).toHaveLength(15);
    expect(res.json().strategy.hypotheses).toHaveLength(6);
  });

  it('answers a single option unchanged, since combining one thing is that thing', async () => {
    const app = await buildApp();

    expect((await get(app, 'optionIndexes=1')).json().strategy.name).toBe('Content-led');
  });

  it('refuses a malformed index list instead of reading NaN as an index', async () => {
    const app = await buildApp();

    expect((await get(app, 'optionIndexes=abc')).statusCode).toBe(400);
    expect((await get(app, 'optionIndexes=')).statusCode).toBe(400);
  });

  it('refuses an index the proposal does not have', async () => {
    const app = await buildApp();

    expect((await get(app, 'optionIndexes=0,7')).statusCode).toBe(400);
  });

  it('404s for a run in another workspace', async () => {
    const app = await buildApp(null);

    expect((await get(app, 'optionIndexes=0')).statusCode).toBe(404);
  });

  it('refuses a run that did not propose strategies, or has not finished', async () => {
    expect((await get(await buildApp({ ...RUN, taskType: 'research-growth-context' }), 'optionIndexes=0')).statusCode).toBe(400);
    expect((await get(await buildApp({ ...RUN, status: 'RUNNING' }), 'optionIndexes=0')).statusCode).toBe(400);
  });
});

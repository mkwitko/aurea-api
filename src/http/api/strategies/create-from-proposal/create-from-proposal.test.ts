import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../../lib/errors.js';
import { createFromProposalRoute } from './create-from-proposal.controller.js';

const RUN_ID = '11111111-1111-1111-1111-111111111111';
const GOAL_ID = '22222222-2222-2222-2222-222222222222';

function option(name = 'Founder-led outbound') {
  return {
    name,
    strategicThesis: 'Ops leads answer a person, not a campaign.',
    growthMechanism: 'Outbound',
    expectedOutcome: 'Ten discovery calls in three weeks',
    channels: ['Email'],
    assumptions: ['Ops leads read email'],
    risks: ['Deliverability'],
    tradeoffs: 'Slower than paid, cheaper to learn from.',
    hypotheses: [
      { statement: 'Plain text outperforms templates', rationale: 'Templates read as marketing', targetMetric: 'reply_rate', expectedOutcome: 'Reply rate above 12%', confidence: 'MEDIUM' },
      { statement: 'Three touches beat one', rationale: 'One touch is missed, not refused', targetMetric: 'reply_rate', expectedOutcome: 'Reply rate above 15%', confidence: 'LOW' },
    ],
  };
}

const RUN = {
  id: RUN_ID,
  workspaceId: 'ws-1',
  taskType: 'propose-strategies',
  status: 'COMPLETED',
  input: { goalId: GOAL_ID },
  output: { options: [option(), option('Content-led')], recommendedIndex: 0, rationale: 'Cheapest way to learn.' },
};

const create = vi.fn();

function prismaFake(run: unknown = RUN, goalCount = 1, used: Array<{ sourceOptionIndex: number | null; sourceOptionIndexes: number[] }> = []) {
  return {
    agentRun: { findFirst: vi.fn().mockResolvedValue(run) },
    // O goal do run é relido do input, não do body, mas precisa existir
    // neste workspace — countGoals é como o create-strategy irmão confirma
    // isso.
    goal: { count: vi.fn().mockResolvedValue(goalCount) },
    strategy: {
      // `usedOptionIndexes` — nenhuma opção desta proposta foi adotada ainda,
      // salvo quando um teste diz o contrário.
      findMany: vi.fn().mockResolvedValue(used),
      // strategyResponse serializes strictly against strategySchema, so the
      // fake resolved row needs a real uuid and every nullable column present
      // (undefined isn't the same as null to a strict `.nullable()` parse) —
      // exactly what a real `prisma.strategy.create()` row always has.
      create: create.mockResolvedValue({
        id: '44444444-4444-4444-4444-444444444444',
        workspaceId: '33333333-3333-3333-3333-333333333333',
        name: 'Founder-led outbound',
        description: null,
        objective: null,
        strategicThesis: null,
        growthMechanism: null,
        expectedOutcome: null,
        status: 'DRAFT',
        version: 1,
        priority: 'MEDIUM',
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
        goals: [],
        icps: [],
      }),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

async function buildApp(
  run: unknown = RUN,
  goalCount = 1,
  used: Array<{ sourceOptionIndex: number | null; sourceOptionIndexes: number[] }> = [],
) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prismaFake(run, goalCount, used) as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: 'ws-1', role: 'MEMBER' };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
    throw error;
  });
  await app.register(createFromProposalRoute);
  return app;
}

describe('POST /strategies/from-proposal', () => {
  it('creates the strategy and its hypotheses in one write', async () => {
    // Uma sequência de chamadas pode falhar no meio e deixar uma estratégia
    // com uma das três hipóteses e nenhum retry limpo.
    const app = await buildApp();

    const res = await app.inject({ method: 'POST', url: '/strategies/from-proposal', payload: { agentRunId: RUN_ID, optionIndexes: [0] } });

    expect(res.statusCode).toBe(201);
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0]![0]!.data as Record<string, unknown>;
    expect(data).toMatchObject({ name: 'Founder-led outbound', status: 'DRAFT', workspaceId: 'ws-1' });
    expect((data.hypotheses as { create: unknown[] }).create).toHaveLength(2);
  });

  it('links the strategy to the goal the run reasoned about', async () => {
    // O goal não vem do body: veio do input do run, e é isso que amarra a
    // estratégia ao objetivo que a produziu.
    const app = await buildApp();

    await app.inject({ method: 'POST', url: '/strategies/from-proposal', payload: { agentRunId: RUN_ID, optionIndexes: [0] } });

    const data = create.mock.calls[0]![0]!.data as { goals: { create: { goalId: string }[] } };
    expect(data.goals.create).toEqual([{ goalId: GOAL_ID }]);
  });

  it('takes the option the caller chose, not always the first', async () => {
    const app = await buildApp();

    await app.inject({ method: 'POST', url: '/strategies/from-proposal', payload: { agentRunId: RUN_ID, optionIndexes: [1] } });

    expect((create.mock.calls[0]![0]!.data as { name: string }).name).toBe('Content-led');
  });

  it('404s for a run in another workspace', async () => {
    const app = await buildApp(null);

    const res = await app.inject({ method: 'POST', url: '/strategies/from-proposal', payload: { agentRunId: RUN_ID, optionIndexes: [0] } });

    expect(res.statusCode).toBe(404);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a run that has not finished', async () => {
    const app = await buildApp({ ...RUN, status: 'RUNNING', output: null });

    const res = await app.inject({ method: 'POST', url: '/strategies/from-proposal', payload: { agentRunId: RUN_ID, optionIndexes: [0] } });

    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses an option index outside the proposal', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'POST', url: '/strategies/from-proposal', payload: { agentRunId: RUN_ID, optionIndexes: [7] } });

    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a stored output that no longer parses', async () => {
    // Um output que não bate mais com o schema do agente não é uma proposta
    // para copiar — é um registro de outra coisa.
    const app = await buildApp({ ...RUN, output: { options: 'nope' } });

    const res = await app.inject({ method: 'POST', url: '/strategies/from-proposal', payload: { agentRunId: RUN_ID, optionIndexes: [0] } });

    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('records which run and which option produced the strategy', async () => {
    // Sem isso a decisão não é auditável (CLAUDE.md princípio 7) e nada impede
    // aceitar a mesma opção duas vezes ao voltar para a página.
    const app = await buildApp();

    await app.inject({ method: 'POST', url: '/strategies/from-proposal', payload: { agentRunId: RUN_ID, optionIndexes: [1] } });

    expect(create.mock.calls[0]![0]!.data).toMatchObject({ sourceAgentRunId: RUN_ID, sourceOptionIndex: 1 });
  });

  // Prisma's P2002 on Postgres reports the violated constraint in two
  // different shapes depending on how it was declared — the column-name array
  // (from an inline `@@unique`) or the index name (from a named unique index),
  // and the index name itself can arrive as either a bare string or a
  // single-element array. A test that only builds one of these shapes cannot
  // tell "the code handles every shape" apart from "the code happens to match
  // the one shape this test picked" — so each is asserted here.
  it.each([
    ['the column-name array', ['sourceAgentRunId', 'sourceOptionIndex']],
    ['the index name as a string', 'Strategy_sourceAgentRunId_sourceOptionIndex_key'],
    ['the index name as a single-element array', ['Strategy_sourceAgentRunId_sourceOptionIndex_key']],
  ])('refuses a second accept of the same option, when Prisma reports %s', async (_label, target) => {
    // O índice único no banco é quem garante isso; aqui a rota precisa
    // traduzir a violação em uma recusa legível em vez de um 500, seja qual
    // for a forma em que o Prisma relatar o alvo da constraint.
    const app = await buildApp();
    create.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { modelName: 'Strategy', target },
      }),
    );

    const res = await app.inject({ method: 'POST', url: '/strategies/from-proposal', payload: { agentRunId: RUN_ID, optionIndexes: [0] } });

    expect(res.statusCode).toBe(400);
  });

  it('lets an unrelated P2002 escape as a 500, instead of mistranslating it', async () => {
    // Uma violação de unicidade que não nomeia nenhuma das duas colunas de
    // proveniência não é "já aceita" — é outra coisa, e mascará-la como 400
    // esconderia um bug real atrás de uma mensagem de recusa esperada.
    const app = await buildApp();
    create.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { modelName: 'Goal', target: ['workspaceId', 'name'] },
      }),
    );

    const res = await app.inject({ method: 'POST', url: '/strategies/from-proposal', payload: { agentRunId: RUN_ID, optionIndexes: [0] } });

    // The test's own error handler rethrows anything that is not an AppError,
    // and Fastify's default handler then answers 500 — an opaque failure,
    // never the readable 400 that only the provenance columns earn.
    expect(res.statusCode).toBe(500);
  });

  it('refuses a run whose goal is not in this workspace', async () => {
    // O input do run garante forma de uuid, não existência: get_growth_context
    // devolve "goal não encontrado" como dado, não como erro, então um run
    // pode completar carregando um goalId de outro workspace ou inexistente.
    const app = await buildApp(RUN, 0);

    const res = await app.inject({ method: 'POST', url: '/strategies/from-proposal', payload: { agentRunId: RUN_ID, optionIndexes: [0] } });

    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a run of a different task type', async () => {
    const app = await buildApp({ ...RUN, taskType: 'summarize-business-context' });

    const res = await app.inject({ method: 'POST', url: '/strategies/from-proposal', payload: { agentRunId: RUN_ID, optionIndexes: [0] } });

    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('POST /strategies/from-proposal — combining options and editing the plan', () => {
  const post = (app: Awaited<ReturnType<typeof buildApp>>, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/strategies/from-proposal', payload });

  it('merges the chosen options into one plan, without repeating what they share', async () => {
    const app = await buildApp();

    const res = await post(app, { agentRunId: RUN_ID, optionIndexes: [0, 1] });

    expect(res.statusCode).toBe(201);
    const written = create.mock.calls[0]![0]!.data as Record<string, unknown>;
    expect(written.name).toBe('Founder-led outbound + Content-led');
    // Ambas as opções citam Email: um plano combinado não tem dois canais Email.
    expect(written.channels).toEqual(['Email']);
    // Cada bloco de texto diz de qual opção veio, porque um plano combinado sem
    // isso não é auditável depois.
    expect(written.strategicThesis).toContain('Founder-led outbound:');
    expect(written.strategicThesis).toContain('Content-led:');
  });

  it('carries every hypothesis of every option it merged', async () => {
    const app = await buildApp();

    await post(app, { agentRunId: RUN_ID, optionIndexes: [0, 1] });

    const written = create.mock.calls[0]![0]!.data as { hypotheses: { create: unknown[] } };
    // Duas hipóteses por opção: descartar as de uma delas esvaziaria metade do
    // plano que o fundador acabou de montar.
    expect(written.hypotheses.create).toHaveLength(4);
  });

  it('records every option that went into the plan, and the lowest as the primary', async () => {
    const app = await buildApp();

    await post(app, { agentRunId: RUN_ID, optionIndexes: [1, 0] });

    expect(create.mock.calls[0]![0]!.data).toMatchObject({
      sourceAgentRunId: RUN_ID,
      sourceOptionIndex: 0,
      sourceOptionIndexes: [0, 1],
    });
  });

  it('writes the founder\'s edited text instead of the agent\'s, when it is sent', async () => {
    const app = await buildApp();

    const res = await post(app, {
      agentRunId: RUN_ID,
      optionIndexes: [0],
      strategy: {
        name: 'Outbound, but only to ops leads',
        strategicThesis: 'They answer a person. We will write like one.',
        growthMechanism: 'Outbound',
        expectedOutcome: 'Ten calls in three weeks',
        channels: ['Email', 'LinkedIn'],
        assumptions: ['Ops leads read email'],
        risks: ['Deliverability'],
        hypotheses: [
          {
            statement: 'Plain text outperforms templates',
            rationale: 'Templates read as marketing',
            targetMetric: 'reply_rate',
            expectedOutcome: 'Reply rate above 12%',
            confidence: 'HIGH',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const written = create.mock.calls[0]![0]!.data as Record<string, unknown>;
    expect(written.name).toBe('Outbound, but only to ops leads');
    expect(written.channels).toEqual(['Email', 'LinkedIn']);
    // A proveniência sobrevive à edição: o plano continua sabendo de qual
    // proposta e de qual opção ele saiu.
    expect(written).toMatchObject({ sourceAgentRunId: RUN_ID, sourceOptionIndexes: [0] });
  });

  it('refuses edited text that would not fit the column', async () => {
    const app = await buildApp();

    const res = await post(app, {
      agentRunId: RUN_ID,
      optionIndexes: [0],
      strategy: {
        name: 'x'.repeat(201),
        strategicThesis: 'ok',
        growthMechanism: 'Outbound',
        expectedOutcome: 'ok',
        channels: ['Email'],
        assumptions: ['ok'],
        risks: ['ok'],
        hypotheses: [
          {
            statement: 'ok',
            rationale: 'ok',
            targetMetric: 'reply_rate',
            expectedOutcome: 'ok',
            confidence: 'LOW',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  // A unicidade do banco só vê o índice primário, então sem a checagem no
  // serviço, combinar 0+1 e depois adotar a 1 sozinha criaria duas estratégias
  // dizendo a mesma coisa.
  it('refuses an option already spent inside a combined plan', async () => {
    const app = await buildApp(RUN, 1, [{ sourceOptionIndex: 0, sourceOptionIndexes: [0, 1] }]);

    const res = await post(app, { agentRunId: RUN_ID, optionIndexes: [1] });

    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses an empty selection, and one bigger than the proposal can hold', async () => {
    const app = await buildApp();

    expect((await post(app, { agentRunId: RUN_ID, optionIndexes: [] })).statusCode).toBe(400);
    expect((await post(app, { agentRunId: RUN_ID, optionIndexes: [0, 1, 2, 3] })).statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('does not duplicate an option the caller sent twice', async () => {
    const app = await buildApp();

    await post(app, { agentRunId: RUN_ID, optionIndexes: [0, 0] });

    const written = create.mock.calls[0]![0]!.data as { hypotheses: { create: unknown[] } };
    expect(written.hypotheses.create).toHaveLength(2);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../../lib/errors.js';
import { learningFromRunRoute } from './from-run.controller.js';

const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';
const RUN_ID = '33333333-3333-3333-3333-333333333333';
const EXPERIMENT_ID = '11111111-1111-1111-1111-111111111111';

const OUTPUT = {
  reading: 'Replies reached 18 against a baseline of 4.',
  drivers: ['The list was filtered to recently funded founders.'],
  caveats: ['One month is a short window.'],
  learning: {
    title: 'Funding-round personalization lifts reply rate',
    statement: 'Referencing a recent raise lifted replies above baseline.',
    evidence: ['18 replies on 2026-07-30', 'baseline was 4'],
    confidence: 'MEDIUM',
  },
};

const RUN = {
  id: RUN_ID,
  taskType: 'interpret-outcome',
  status: 'COMPLETED',
  input: { experimentId: EXPERIMENT_ID },
  output: OUTPUT,
};

const created = vi.fn();

function prismaFake(run: unknown = RUN, createImpl?: () => unknown) {
  return {
    agentRun: { findFirst: vi.fn().mockResolvedValue(run) },
    learning: {
      create: created.mockImplementation(createImpl ?? (async ({ data }: { data: Record<string, unknown> }) => ({
        id: '55555555-5555-5555-5555-555555555555',
        workspaceId: WORKSPACE_ID,
        experimentId: EXPERIMENT_ID,
        evidence: null,
        status: 'CANDIDATE',
        createdAt: new Date('2026-07-30T00:00:00Z'),
        validatedAt: null,
        archivedAt: null,
        sourceAgentRunId: RUN_ID,
        ...data,
      }))),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

async function buildApp(prisma: unknown) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prisma as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: WORKSPACE_ID, role: 'MEMBER' };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
    throw error;
  });
  await app.register(learningFromRunRoute);
  return app;
}

describe('POST /learnings/from-run', () => {
  it('creates one candidate learning from the run', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({ method: 'POST', url: '/learnings/from-run', payload: { agentRunId: RUN_ID } });

    expect(res.statusCode).toBe(201);
    const data = created.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).toMatchObject({
      workspaceId: WORKSPACE_ID,
      // From the run's input, never from the request body.
      experimentId: EXPERIMENT_ID,
      title: OUTPUT.learning.title,
      statement: OUTPUT.learning.statement,
      confidence: 'MEDIUM',
      sourceAgentRunId: RUN_ID,
    });
    // Validation stays a human act: the row is always a candidate.
    expect(res.json().learning.status).toBe('CANDIDATE');
  });

  it('stores the reading and the caveats alongside the evidence', async () => {
    const app = await buildApp(prismaFake());

    await app.inject({ method: 'POST', url: '/learnings/from-run', payload: { agentRunId: RUN_ID } });

    const data = created.mock.calls[0]![0].data as { evidence: unknown };
    expect(data.evidence).toEqual({
      points: OUTPUT.learning.evidence,
      reading: OUTPUT.reading,
      caveats: OUTPUT.caveats,
    });
  });

  it('refuses a second accept with 400, not 500, and creates nothing', async () => {
    const conflict = Object.assign(new Error('unique'), {
      code: 'P2002',
      meta: { target: 'Learning_sourceAgentRunId_key' },
    });
    const app = await buildApp(prismaFake(RUN, () => { throw conflict; }));

    const res = await app.inject({ method: 'POST', url: '/learnings/from-run', payload: { agentRunId: RUN_ID } });

    expect(res.statusCode).toBe(400);
  });

  it.each([
    [{ ...RUN, taskType: 'propose-strategies' }, 400],
    [{ ...RUN, status: 'RUNNING' }, 400],
    [{ ...RUN, output: { reading: 'only this' } }, 400],
    [null, 404],
  ])('refuses run %#', async (run, status) => {
    const app = await buildApp(prismaFake(run));

    const res = await app.inject({ method: 'POST', url: '/learnings/from-run', payload: { agentRunId: RUN_ID } });

    expect(res.statusCode).toBe(status);
    expect(created).not.toHaveBeenCalled();
  });

  it('looks the run up inside the workspace', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    await app.inject({ method: 'POST', url: '/learnings/from-run', payload: { agentRunId: RUN_ID } });

    expect(prisma.agentRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: RUN_ID, workspaceId: WORKSPACE_ID } }),
    );
  });
});

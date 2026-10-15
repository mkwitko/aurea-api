import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { LearningStatus } from '@prisma/client';
import { AppError } from '../../../lib/errors.js';
import { createLearningRoute } from './create-learning/create-learning.controller.js';
import { listLearningsRoute } from './list-learnings/list-learnings.controller.js';
import { validateLearningRoute } from './validate-learning/validate-learning.controller.js';
import { rejectLearningRoute } from './reject-learning/reject-learning.controller.js';
import { archiveLearningRoute } from './archive-learning/archive-learning.controller.js';

const LEARNING_ID = '11111111-1111-1111-1111-111111111111';
const EXPERIMENT_ID = '22222222-2222-2222-2222-222222222222';
const WORKSPACE_ID = '33333333-3333-3333-3333-333333333333';

const LEARNING = {
  id: LEARNING_ID,
  workspaceId: WORKSPACE_ID,
  experimentId: EXPERIMENT_ID,
  title: 'Plain text beats templates for ops leads',
  statement: 'Replies tripled when the first touch was plain text.',
  evidence: null,
  confidence: 'MEDIUM',
  status: 'CANDIDATE' as LearningStatus,
  createdAt: new Date('2026-07-28T00:00:00Z'),
  validatedAt: null,
  archivedAt: null,
  sourceAgentRunId: null,
};

const create = vi.fn();
const update = vi.fn();
const findMany = vi.fn();

function prismaFake(status: LearningStatus = 'CANDIDATE') {
  return {
    learning: {
      create: create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        ...LEARNING,
        ...data,
      })),
      findFirst: vi.fn().mockResolvedValue({ ...LEARNING, status }),
      findMany: findMany.mockResolvedValue([{ ...LEARNING, status }]),
      update: update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        ...LEARNING,
        ...data,
      })),
    },
    experiment: { findFirst: vi.fn().mockResolvedValue({ id: EXPERIMENT_ID }) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

async function buildApp(status: LearningStatus = 'CANDIDATE') {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prismaFake(status) as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: WORKSPACE_ID, role: 'MEMBER' };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
    throw error;
  });
  await app.register(createLearningRoute);
  await app.register(listLearningsRoute);
  await app.register(validateLearningRoute);
  await app.register(rejectLearningRoute);
  await app.register(archiveLearningRoute);
  return app;
}

describe('POST /learnings', () => {
  it('files a new learning as a candidate', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/learnings',
      payload: { title: LEARNING.title, statement: LEARNING.statement, experimentId: EXPERIMENT_ID },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().learning.status).toBe('CANDIDATE');
  });

  it('cannot be created already validated, whatever the body asks for', async () => {
    // "Learning candidates are proposed… They are validated before becoming
    // canonical knowledge" — docs/domains/analytics.md §19. Letting the create
    // call set VALIDATED would skip the only step that makes it knowledge.
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/learnings',
      payload: { title: LEARNING.title, statement: LEARNING.statement, status: 'VALIDATED' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().learning.status).toBe('CANDIDATE');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CANDIDATE' }) }),
    );
  });

  it('404s when the experiment it points at belongs to someone else', async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('prisma', {
      learning: { create },
      experiment: { findFirst: vi.fn().mockResolvedValue(null) },
    } as never);
    app.addHook('preHandler', async (req) => {
      req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: WORKSPACE_ID, role: 'MEMBER' };
    });
    app.setErrorHandler((error, _req, reply) => {
      if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
      throw error;
    });
    await app.register(createLearningRoute);

    const res = await app.inject({
      method: 'POST',
      url: '/learnings',
      payload: { title: LEARNING.title, statement: LEARNING.statement, experimentId: EXPERIMENT_ID },
    });

    expect(res.statusCode).toBe(404);
    expect(create).not.toHaveBeenCalled();
  });

  it('accepts a learning with no experiment behind it', async () => {
    // The model allows it and so does the domain: not everything learned comes
    // out of a formal experiment.
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/learnings',
      payload: { title: LEARNING.title, statement: LEARNING.statement },
    });

    expect(res.statusCode).toBe(201);
  });

  it('lets several hand-written learnings coexist, all with sourceAgentRunId null', async () => {
    // sourceAgentRunId is unique but nullable, and Postgres treats NULLs as
    // distinct in a unique index — a manual learning never sets it, so any
    // number of them can be filed. This mock cannot exercise the real
    // Postgres index (that guarantee is proven by the migration itself and by
    // Postgres's documented NULL handling); what it does prove is that the
    // application layer never forces a value onto a manual create, which
    // would otherwise collide on the second one even before reaching the DB.
    const app = await buildApp();

    const first = await app.inject({
      method: 'POST',
      url: '/learnings',
      payload: { title: LEARNING.title, statement: LEARNING.statement },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/learnings',
      payload: { title: 'A second, unrelated learning', statement: 'Also written by hand.' },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(create).toHaveBeenCalledTimes(2);
    for (const call of create.mock.calls) {
      expect((call[0] as { data: Record<string, unknown> }).data.sourceAgentRunId).toBeUndefined();
    }
    expect(first.json().learning.sourceAgentRunId).toBeNull();
    expect(second.json().learning.sourceAgentRunId).toBeNull();
  });
});

describe('GET /learnings', () => {
  it('filters by experiment and status server-side', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: `/learnings?experimentId=${EXPERIMENT_ID}&status=CANDIDATE` });

    expect(res.statusCode).toBe(200);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: WORKSPACE_ID, experimentId: EXPERIMENT_ID, status: 'CANDIDATE' },
      }),
    );
  });
});

describe('learning transitions', () => {
  it('validates a candidate and stamps when it happened', async () => {
    const app = await buildApp('CANDIDATE');

    const res = await app.inject({ method: 'POST', url: `/learnings/${LEARNING_ID}/validate` });

    expect(res.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'VALIDATED', validatedAt: expect.any(Date) }),
      }),
    );
  });

  it('rejects a candidate', async () => {
    const app = await buildApp('CANDIDATE');

    const res = await app.inject({ method: 'POST', url: `/learnings/${LEARNING_ID}/reject` });

    expect(res.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }),
    );
  });

  it('archives a decided learning and stamps when', async () => {
    const app = await buildApp('VALIDATED');

    const res = await app.inject({ method: 'POST', url: `/learnings/${LEARNING_ID}/archive` });

    expect(res.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ARCHIVED', archivedAt: expect.any(Date) }),
      }),
    );
  });

  it('refuses to re-decide a learning that is already settled', async () => {
    // Validation settles the question; a validated learning that can be
    // rejected later was never knowledge.
    const app = await buildApp('VALIDATED');

    const res = await app.inject({ method: 'POST', url: `/learnings/${LEARNING_ID}/reject` });

    expect(res.statusCode).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses to validate something already archived', async () => {
    const app = await buildApp('ARCHIVED');

    const res = await app.inject({ method: 'POST', url: `/learnings/${LEARNING_ID}/validate` });

    expect(res.statusCode).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('404s for a learning in another workspace', async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('prisma', { learning: { findFirst: vi.fn().mockResolvedValue(null), update } } as never);
    app.addHook('preHandler', async (req) => {
      req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: WORKSPACE_ID, role: 'MEMBER' };
    });
    app.setErrorHandler((error, _req, reply) => {
      if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
      throw error;
    });
    await app.register(validateLearningRoute);

    const res = await app.inject({ method: 'POST', url: `/learnings/${LEARNING_ID}/validate` });

    expect(res.statusCode).toBe(404);
  });
});

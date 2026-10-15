import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Role } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { denyReadOnly } from '../../plugins/tenant.js';
import { businessRoutes } from './business/index.js';
import { icpsRoutes } from './icps/index.js';
import { goalsRoutes } from './goals/index.js';
import { strategiesRoutes } from './strategies/index.js';
import { hypothesesRoutes } from './hypotheses/index.js';
import { experimentsRoutes } from './experiments/index.js';
import { outcomesRoutes } from './outcomes/index.js';
import { learningsRoutes } from './learnings/index.js';
import { uploadRoute } from './upload/upload.controller.js';

/**
 * Broad enough for the routes exercised here. Every write below is expected to
 * be refused in `preHandler`, so for a VIEWER these are never reached — they
 * exist so the allowed direction (a MEMBER getting through the guard) can be
 * told apart from a crash.
 */
function prismaFake() {
  const goal = { id: 'goal-1', workspaceId: 'ws-1', name: 'Ten calls', metric: 'calls', status: 'DRAFT' };
  const hypothesis = { id: 'hyp-1', workspaceId: 'ws-1', strategyId: 'str-1', statement: 'x', status: 'DRAFT' };
  return {
    goal: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(goal),
      create: vi.fn().mockResolvedValue(goal),
      update: vi.fn().mockResolvedValue(goal),
    },
    icp: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    strategy: { findMany: vi.fn().mockResolvedValue([]) },
    agentRun: { findFirst: vi.fn().mockResolvedValue(null) },
    hypothesis: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(hypothesis),
      create: vi.fn().mockResolvedValue(hypothesis),
      update: vi.fn().mockResolvedValue(hypothesis),
    },
    experiment: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue({ id: 'exp-1', metric: 'm' }) },
    metricBinding: {
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ id: 'mb-1', experimentId: 'exp-1', provider: 'GA4', config: { metric: 'conversions' } }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    learning: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn() },
    outcome: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
    business: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})),
  };
}

async function buildApp(role: Role) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prismaFake() as never);
  // The modules install `authenticate` and `resolveTenant` themselves, so the
  // guard has to be tested through the real registration path — a hook added
  // straight onto the test app would prove nothing about the modules.
  app.decorate('authenticate', async () => {});
  app.decorate('resolveTenant', async (request: { tenant?: unknown }) => {
    request.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: 'ws-1', role };
  });
  // The real guard, not a stand-in: a copy here could pass while the shipped
  // hook is wrong.
  app.decorate('denyReadOnly', denyReadOnly as never);
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
    throw error;
  });
  await app.register(businessRoutes);
  await app.register(icpsRoutes);
  await app.register(goalsRoutes);
  await app.register(strategiesRoutes);
  await app.register(hypothesesRoutes);
  await app.register(experimentsRoutes);
  await app.register(outcomesRoutes);
  await app.register(learningsRoutes);
  // Upload is registered by app.ts inside its own auth scope rather than by a
  // module of its own, so the guard has to be applied there too — and a signed
  // upload URL is a write, whatever the object is.
  await app.register(async (child) => {
    child.addHook('preHandler', app.authenticate);
    child.addHook('preHandler', app.resolveTenant);
    child.addHook('preHandler', denyReadOnly as never);
    await child.register(uploadRoute);
  });
  return app;
}

/** One representative write per domain, plus one lifecycle transition each. */
const WRITES: Array<{ method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'; url: string; payload?: unknown }> = [
  { method: 'POST', url: '/business', payload: { name: 'Acme' } },
  { method: 'PATCH', url: '/business', payload: { name: 'Acme' } },
  { method: 'DELETE', url: '/business' },
  { method: 'POST', url: '/icps', payload: { name: 'Ops leads' } },
  { method: 'POST', url: '/goals', payload: { name: 'Ten calls', metric: 'calls' } },
  { method: 'POST', url: '/goals/11111111-1111-1111-1111-111111111111/activate' },
  { method: 'POST', url: '/strategies', payload: { name: 'Outbound', goalIds: ['11111111-1111-1111-1111-111111111111'] } },
  { method: 'POST', url: '/strategies/from-proposal', payload: { agentRunId: '11111111-1111-1111-1111-111111111111', optionIndexes: [0] } },
  { method: 'POST', url: '/strategies/11111111-1111-1111-1111-111111111111/plan-experiments' },
  { method: 'POST', url: '/experiments/from-proposal', payload: { agentRunId: '11111111-1111-1111-1111-111111111111' } },
  {
    method: 'POST',
    url: '/business/context/from-research',
    payload: { agentRunId: '11111111-1111-1111-1111-111111111111', findingIndexes: [0] },
  },
  { method: 'POST', url: '/hypotheses', payload: { strategyId: '11111111-1111-1111-1111-111111111111', statement: 'x' } },
  { method: 'POST', url: '/hypotheses/11111111-1111-1111-1111-111111111111/validate' },
  { method: 'POST', url: '/experiments', payload: { hypothesisId: '11111111-1111-1111-1111-111111111111', name: 'x', metric: 'y' } },
  { method: 'POST', url: '/experiments/11111111-1111-1111-1111-111111111111/approve' },
  { method: 'POST', url: '/experiments/11111111-1111-1111-1111-111111111111/cancel' },
  { method: 'POST', url: '/experiments/11111111-1111-1111-1111-111111111111/outcomes', payload: { value: 9 } },
  { method: 'PUT', url: '/experiments/11111111-1111-1111-1111-111111111111/metric-binding', payload: { provider: 'GA4', config: { metric: 'conversions' } } },
  { method: 'DELETE', url: '/experiments/11111111-1111-1111-1111-111111111111/metric-binding' },
  { method: 'POST', url: '/learnings', payload: { title: 'x', statement: 'y' } },
  { method: 'POST', url: '/learnings/from-run', payload: { agentRunId: '11111111-1111-1111-1111-111111111111' } },
  { method: 'POST', url: '/learnings/11111111-1111-1111-1111-111111111111/validate' },
  { method: 'POST', url: '/upload/presigned', payload: { type: 'logo', filename: 'a.png', contentType: 'image/png', size: 10 } },
];

const READS = ['/business', '/icps', '/goals', '/strategies', '/hypotheses', '/experiments', '/learnings'];

describe('read-only roles cannot write', () => {
  it.each(WRITES)('refuses a VIEWER on $method $url', async ({ method, url, payload }) => {
    // A VIEWER is read-only by definition. Without a guard, one can approve,
    // start or cancel an experiment, delete the business, or file hypotheses —
    // the API is the only thing enforcing this, since hiding a button in the
    // client is not a permission.
    const app = await buildApp('VIEWER');

    const res = await app.inject({ method, url, ...(payload ? { payload } : {}) });

    expect(res.statusCode).toBe(403);
  });

  it.each(READS)('still lets a VIEWER read %s', async (url) => {
    // The other half of "read-only": the guard must not turn a viewer into a
    // user who can see nothing.
    const app = await buildApp('VIEWER');

    const res = await app.inject({ method: 'GET', url });

    expect(res.statusCode).toBe(200);
  });

  it('lets a MEMBER through the guard', async () => {
    // MEMBER writes content — that is the role's whole purpose. If this ever
    // returns 403 the guard is denying the wrong people.
    const app = await buildApp('MEMBER');

    const res = await app.inject({ method: 'POST', url: '/goals', payload: { name: 'Ten calls', metric: 'calls' } });

    expect(res.statusCode).not.toBe(403);
  });
});

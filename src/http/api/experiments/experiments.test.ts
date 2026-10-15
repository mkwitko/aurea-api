import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { ExperimentStatus } from '@prisma/client';
import { AppError } from '../../../lib/errors.js';
import { updateExperimentRoute } from './update-experiment/update-experiment.controller.js';
import { assertReadyToPlan, PLAN_REQUIRED_FIELDS } from './experiments.domain.js';

const EXPERIMENT = {
  id: '11111111-1111-1111-1111-111111111111',
  workspaceId: '22222222-2222-2222-2222-222222222222',
  strategyId: '33333333-3333-3333-3333-333333333333',
  hypothesisId: '44444444-4444-4444-4444-444444444444',
  name: 'Cold email to ops leads',
  description: null,
  objective: null,
  channel: null,
  audience: null,
  variables: null,
  metric: 'discovery_calls_booked',
  baselineValue: 2,
  targetValue: 10,
  successCriteria: 'At least 8 calls booked in 3 weeks',
  startDate: null,
  endDate: null,
  status: 'DRAFT' as ExperimentStatus,
  createdAt: new Date('2026-07-28T00:00:00Z'),
  updatedAt: new Date('2026-07-28T00:00:00Z'),
  completedAt: null,
};

const update = vi.fn();

function prismaFake(status: ExperimentStatus) {
  return {
    experiment: {
      findFirst: vi.fn().mockResolvedValue({ ...EXPERIMENT, status }),
      update: update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        ...EXPERIMENT,
        status,
        ...data,
      })),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

async function buildApp(status: ExperimentStatus) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prismaFake(status) as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: 'ws-1', role: 'OWNER' };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
    throw error;
  });
  await app.register(updateExperimentRoute);
  return app;
}

/** The fields that define what success means, per docs/domains/experiments.md §13. */
const MEASUREMENT_FIELDS = [
  { successCriteria: 'Whatever we happened to get' },
  { metric: 'something_easier' },
  { targetValue: 1 },
  { baselineValue: 0 },
];

const FROZEN: ExperimentStatus[] = ['APPROVED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED'];
const EDITABLE: ExperimentStatus[] = ['DRAFT', 'PLANNED'];

describe('PATCH /experiments/:id', () => {
  for (const status of FROZEN) {
    it.each(MEASUREMENT_FIELDS)(`refuses to rewrite %o once the experiment is ${status}`, async (payload) => {
      // "Success Criteria must be defined before the Experiment runs. Defining
      // success after seeing results invalidates the test." — docs/domains/
      // experiments.md §13. Without this, a disappointing number is answered by
      // editing the target, and the experiment proves nothing.
      const app = await buildApp(status);

      const res = await app.inject({ method: 'PATCH', url: '/experiments/11111111-1111-1111-1111-111111111111', payload });

      expect(res.statusCode).toBe(409);
      expect(update).not.toHaveBeenCalled();
    });

    it(`still allows descriptive edits while ${status}`, async () => {
      // Fixing a typo in the audience is not moving the goalposts; freezing
      // everything would push people to cancel and re-create instead.
      const app = await buildApp(status);

      const res = await app.inject({
        method: 'PATCH',
        url: '/experiments/11111111-1111-1111-1111-111111111111',
        payload: { audience: 'Ops leads at 50-200 headcount', name: 'Cold email v2' },
      });

      expect(res.statusCode).toBe(200);
      expect(update).toHaveBeenCalled();
    });
  }

  for (const status of EDITABLE) {
    it.each(MEASUREMENT_FIELDS)(`still accepts %o while the experiment is ${status}`, async (payload) => {
      // Before it runs, the whole point is to get the measurement right.
      const app = await buildApp(status);

      const res = await app.inject({ method: 'PATCH', url: '/experiments/11111111-1111-1111-1111-111111111111', payload });

      expect(res.statusCode).toBe(200);
    });
  }

  it('404s for an experiment outside the workspace', async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('prisma', { experiment: { findFirst: vi.fn().mockResolvedValue(null), update } } as never);
    app.addHook('preHandler', async (req) => {
      req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: 'ws-1', role: 'OWNER' };
    });
    app.setErrorHandler((error, _req, reply) => {
      if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
      throw error;
    });
    await app.register(updateExperimentRoute);

    const res = await app.inject({ method: 'PATCH', url: '/experiments/11111111-1111-1111-1111-111111111111', payload: { name: 'x' } });

    expect(res.statusCode).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });
});

const ready = {
  metric: 'reply_rate',
  baselineValue: 4.2,
  targetValue: 6,
  startDate: new Date('2026-08-10'),
  endDate: new Date('2026-09-07'),
  successCriteria: 'Acima de 6% com pelo menos 50 respostas',
  audience: 'Fundadores B2B SaaS',
  channel: 'Email',
};

describe('assertReadyToPlan', () => {
  it('aceita um experimento com o design completo', () => {
    expect(() => assertReadyToPlan(ready)).not.toThrow();
  });

  // docs/domains/experiments.md §18: "A Planned Experiment has a complete
  // design" — Baseline, Target e Duration incluídos.
  it.each(PLAN_REQUIRED_FIELDS)('recusa quando falta %s', (field) => {
    expect(() => assertReadyToPlan({ ...ready, [field]: null })).toThrow(/not ready/i);
  });

  it('nomeia todos os campos ausentes de uma vez', () => {
    try {
      assertReadyToPlan({ ...ready, baselineValue: null, targetValue: null });
      expect.unreachable('deveria ter lançado');
    } catch (error) {
      expect(JSON.stringify(error)).toContain('baselineValue');
      expect(JSON.stringify(error)).toContain('targetValue');
    }
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../lib/errors.js';
import { createOutcomeRoute } from './create-outcome/create-outcome.controller.js';
import { listOutcomesRoute } from './list-outcomes/list-outcomes.controller.js';

const EXPERIMENT_ID = '11111111-1111-1111-1111-111111111111';
const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';

const EXPERIMENT = { id: EXPERIMENT_ID, workspaceId: WORKSPACE_ID, metric: 'discovery_calls_booked' };

const OUTCOMES = [
  {
    id: '55555555-5555-5555-5555-555555555555',
    workspaceId: WORKSPACE_ID,
    experimentId: EXPERIMENT_ID,
    metric: 'discovery_calls_booked',
    value: 9,
    unit: 'calls',
    observedAt: new Date('2026-07-20T00:00:00Z'),
    source: 'USER',
    createdAt: new Date('2026-07-20T00:00:00Z'),
    updatedAt: new Date('2026-07-20T00:00:00Z'),
  },
  {
    id: '66666666-6666-6666-6666-666666666666',
    workspaceId: WORKSPACE_ID,
    experimentId: EXPERIMENT_ID,
    metric: 'discovery_calls_booked',
    value: 14,
    unit: null,
    observedAt: new Date('2026-07-21T00:00:00Z'),
    source: 'GA4',
    periodStart: new Date('2026-07-01T00:00:00Z'),
    periodEnd: new Date('2026-07-14T00:00:00Z'),
    externalRef: 'properties/123456789:conversions',
    sourceDetail: { metrics: [{ name: 'conversions' }] },
    createdAt: new Date('2026-07-21T00:00:00Z'),
    updatedAt: new Date('2026-07-21T00:00:00Z'),
  },
];

const create = vi.fn();
const findMany = vi.fn();

function prismaFake(experiment: unknown = EXPERIMENT) {
  return {
    experiment: { findFirst: vi.fn().mockResolvedValue(experiment) },
    outcome: {
      // Undefined vira ausente do input do Prisma real (a coluna assume o
      // default, ou fica null se não houver default) — nunca sobrescreve o
      // valor anterior com `undefined`. Um `...data` ingênuo faria isso, e o
      // `observedAt`/`unit` ausentes no corpo do caminho de fonte quebrariam a
      // serialização da resposta com um `undefined` onde o schema espera data.
      create: create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        const defined = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
        return { ...OUTCOMES[0], ...defined };
      }),
      findMany: findMany.mockResolvedValue(OUTCOMES),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

async function buildApp(experiment: unknown = EXPERIMENT, read: ReturnType<typeof vi.fn> = vi.fn()) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prismaFake(experiment) as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: WORKSPACE_ID, role: 'MEMBER' };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
    throw error;
  });
  // O leitor por opção de plugin: sem isto, um teste do caminho de fonte
  // construiria o leitor real contra o prisma falso.
  await app.register(createOutcomeRoute, { read });
  await app.register(listOutcomesRoute);
  return app;
}

describe('POST /experiments/:id/outcomes', () => {
  it('records a measurement against the experiment', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: `/experiments/${EXPERIMENT_ID}/outcomes`,
      payload: { value: 9, unit: 'calls', observedAt: '2026-07-20T00:00:00.000Z' },
    });

    expect(res.statusCode).toBe(201);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ experimentId: EXPERIMENT_ID, workspaceId: WORKSPACE_ID, value: 9, unit: 'calls' }),
      }),
    );
  });

  it("defaults the metric to the experiment's own", async () => {
    // An outcome that silently measures something else cannot be read against
    // the experiment's target — the number would be meaningless next to it.
    const app = await buildApp();

    await app.inject({ method: 'POST', url: `/experiments/${EXPERIMENT_ID}/outcomes`, payload: { value: 9 } });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ metric: 'discovery_calls_booked' }) }),
    );
  });

  it('records where the number came from', async () => {
    // "An Outcome without provenance is not trustworthy" — docs/domains/
    // analytics.md §11. Manual entry is still provenance, and it has to say so.
    const app = await buildApp();

    await app.inject({ method: 'POST', url: `/experiments/${EXPERIMENT_ID}/outcomes`, payload: { value: 9 } });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ source: 'USER' }) }));
  });

  it('refuses a measurement dated in the future', async () => {
    // An observation that has not happened yet is not an observation.
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: `/experiments/${EXPERIMENT_ID}/outcomes`,
      payload: { value: 9, observedAt: '2099-01-01T00:00:00.000Z' },
    });

    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a value that is not a finite number', async () => {
    const app = await buildApp();

    for (const value of ['nine', null, Number.POSITIVE_INFINITY]) {
      const res = await app.inject({ method: 'POST', url: `/experiments/${EXPERIMENT_ID}/outcomes`, payload: { value } });
      expect(res.statusCode).toBe(400);
    }
    expect(create).not.toHaveBeenCalled();
  });

  it('404s for an experiment in another workspace', async () => {
    const app = await buildApp(null);

    const res = await app.inject({ method: 'POST', url: `/experiments/${EXPERIMENT_ID}/outcomes`, payload: { value: 9 } });

    expect(res.statusCode).toBe(404);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('GET /experiments/:id/outcomes', () => {
  it('lists the measurements newest first, scoped to the workspace', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: `/experiments/${EXPERIMENT_ID}/outcomes` });

    expect(res.statusCode).toBe(200);
    // OUTCOMES tem dois itens desde que a proveniência ganhou um segundo
    // fixture (o manual e o de fonte) — a correção mantém o baseline.
    expect(res.json().outcomes).toHaveLength(2);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: WORKSPACE_ID, experimentId: EXPERIMENT_ID },
        orderBy: { observedAt: 'desc' },
      }),
    );
  });

  it('404s for an experiment in another workspace', async () => {
    const app = await buildApp(null);

    const res = await app.inject({ method: 'GET', url: `/experiments/${EXPERIMENT_ID}/outcomes` });

    expect(res.statusCode).toBe(404);
  });
});

describe('proveniência na resposta', () => {
  it('devolve a proveniência do número que veio da fonte', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: `/experiments/${EXPERIMENT_ID}/outcomes` });

    expect(res.statusCode).toBe(200);
    const fromSource = res.json().outcomes.find((outcome: { source: string }) => outcome.source === 'GA4');
    expect(fromSource).toMatchObject({
      source: 'GA4',
      externalRef: 'properties/123456789:conversions',
      sourceDetail: { metrics: [{ name: 'conversions' }] },
    });
    expect(new Date(fromSource.periodStart).toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(new Date(fromSource.periodEnd).toISOString()).toBe('2026-07-14T00:00:00.000Z');
  });

  // O Outcome digitado à mão continua existindo e continua válido: a
  // proveniência dele é `source: 'USER'` e o observedAt informado (spec §8).
  it('devolve nulos na proveniência do número digitado à mão', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: `/experiments/${EXPERIMENT_ID}/outcomes` });

    const manual = res.json().outcomes.find((outcome: { source: string }) => outcome.source === 'USER');
    expect(manual).toMatchObject({
      source: 'USER',
      periodStart: null,
      periodEnd: null,
      externalRef: null,
      sourceDetail: null,
    });
  });
});

describe('POST /experiments/:id/outcomes — caminho de fonte', () => {
  // A trava que não pode ser afrouxada: aceitar `value` junto de `fromSource`
  // seria um número sem origem com selo de origem, pior que digitar à mão
  // porque parece auditado (spec §8).
  it('recusa um valor no corpo junto de fromSource', async () => {
    const read = vi.fn();
    const app = await buildApp(EXPERIMENT, read);

    const res = await app.inject({
      method: 'POST',
      url: `/experiments/${EXPERIMENT_ID}/outcomes`,
      payload: { fromSource: true, value: 999 },
    });

    expect(res.statusCode).toBe(400);
    expect(read).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('recusa um pedido sem valor e sem fromSource', async () => {
    const app = await buildApp(EXPERIMENT, vi.fn());

    const res = await app.inject({
      method: 'POST',
      url: `/experiments/${EXPERIMENT_ID}/outcomes`,
      payload: { unit: 'calls' },
    });

    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('grava o número da fonte com a proveniência', async () => {
    const read = vi.fn().mockResolvedValue({
      value: 42,
      unit: null,
      periodStart: new Date('2026-07-01T00:00:00Z'),
      periodEnd: new Date('2026-07-14T00:00:00Z'),
      externalRef: 'properties/123456789:conversions',
      query: { metrics: [{ name: 'conversions' }] },
      source: 'GA4',
    });
    const app = await buildApp(EXPERIMENT, read);

    const res = await app.inject({
      method: 'POST',
      url: `/experiments/${EXPERIMENT_ID}/outcomes`,
      payload: { fromSource: true },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().outcome).toMatchObject({
      value: 42,
      source: 'GA4',
      externalRef: 'properties/123456789:conversions',
    });
  });

  // O piso continua de pé: um experimento sem amarração mede como hoje. Este é
  // o teste que impede a automação de virar requisito (spec §11).
  it('o caminho manual continua gravando sem tocar no conector', async () => {
    const read = vi.fn();
    const app = await buildApp(EXPERIMENT, read);

    const res = await app.inject({
      method: 'POST',
      url: `/experiments/${EXPERIMENT_ID}/outcomes`,
      payload: { value: 9, unit: 'calls' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().outcome).toMatchObject({ value: 9, source: 'USER' });
    expect(read).not.toHaveBeenCalled();
  });
});

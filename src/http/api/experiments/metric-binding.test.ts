import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../lib/errors.js';
import { getMetricBindingRoute } from './get-metric-binding/get-metric-binding.controller.js';
import { putMetricBindingRoute } from './put-metric-binding/put-metric-binding.controller.js';
import { removeMetricBindingRoute } from './remove-metric-binding/remove-metric-binding.controller.js';

const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';
const EXPERIMENT_ID = '11111111-1111-1111-1111-111111111111';

const BINDING = {
  id: 'mb-1',
  workspaceId: WORKSPACE_ID,
  experimentId: EXPERIMENT_ID,
  provider: 'GA4',
  config: { metric: 'conversions', dimensionFilter: { fieldName: 'eventName', value: 'sign_up' } },
  createdBy: 'u1',
  createdAt: new Date('2026-08-04T00:00:00.000Z'),
  updatedAt: new Date('2026-08-04T00:00:00.000Z'),
};

const prismaFake = (over: { experiment?: unknown; binding?: unknown } = {}) => ({
  // `'experiment' in over`, não `??`: um override explícito de `null` (o caso
  // "experimento de outro workspace") precisa vencer o default, e `??` trataria
  // `null` como "não passou nada" e devolveria o experimento padrão de qualquer
  // jeito — o mesmo cuidado que `binding` já tem abaixo.
  experiment: { findFirst: vi.fn().mockResolvedValue('experiment' in over ? over.experiment : { id: EXPERIMENT_ID }) },
  metricBinding: {
    findFirst: vi.fn().mockResolvedValue('binding' in over ? over.binding : BINDING),
    upsert: vi.fn().mockResolvedValue(BINDING),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
});

beforeEach(() => vi.clearAllMocks());

async function buildApp(prisma: unknown, role: 'MEMBER' | 'VIEWER' = 'MEMBER') {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prisma as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: WORKSPACE_ID, role };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
    throw error;
  });
  await app.register(getMetricBindingRoute);
  await app.register(putMetricBindingRoute);
  await app.register(removeMetricBindingRoute);
  return app;
}

const url = `/experiments/${EXPERIMENT_ID}/metric-binding`;

describe('GET /experiments/:id/metric-binding', () => {
  it('devolve a amarração do experimento', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({ method: 'GET', url });

    expect(res.statusCode).toBe(200);
    expect(res.json().binding).toMatchObject({ provider: 'GA4', config: { metric: 'conversions' } });
  });

  // Sem amarração o experimento continua no caminho manual. 404 é a resposta
  // honesta: não existe amarração, e a tela decide o que oferecer.
  it('404 quando o experimento não tem amarração', async () => {
    const app = await buildApp(prismaFake({ binding: null }));

    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
  });

  it('404 para experimento de outro workspace', async () => {
    const app = await buildApp(prismaFake({ experiment: null, binding: null }));

    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
  });

  it('lê com o workspace do tenant', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    await app.inject({ method: 'GET', url });

    expect(prisma.metricBinding.findFirst).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, experimentId: EXPERIMENT_ID },
    });
  });
});

describe('PUT /experiments/:id/metric-binding', () => {
  const body = { provider: 'GA4', config: { metric: 'conversions' } };

  it('grava a amarração', async () => {
    const prisma = prismaFake({ binding: null });
    const app = await buildApp(prisma);

    const res = await app.inject({ method: 'PUT', url, payload: body });

    expect(res.statusCode).toBe(200);
    expect(prisma.metricBinding.upsert).toHaveBeenCalled();
  });

  // Json livre no banco não pode ser Json livre na entrada: uma amarração
  // malformada só falharia na hora de medir, e o erro chegaria disfarçado de
  // problema da fonte.
  it('recusa uma config que não é uma amarração GA4 válida', async () => {
    const app = await buildApp(prismaFake({ binding: null }));

    expect((await app.inject({ method: 'PUT', url, payload: { provider: 'GA4', config: {} } })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: 'PUT', url, payload: { provider: 'GA4', config: { metric: '' } } })).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url,
          payload: { provider: 'GA4', config: { metric: 'conversions', dimensionFilter: { fieldName: 'eventName' } } },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('404 para experimento de outro workspace, sem gravar', async () => {
    const prisma = prismaFake({ experiment: null, binding: null });
    const app = await buildApp(prisma);

    expect((await app.inject({ method: 'PUT', url, payload: body })).statusCode).toBe(404);
    expect(prisma.metricBinding.upsert).not.toHaveBeenCalled();
  });

  it('nega VIEWER', async () => {
    const app = await buildApp(prismaFake({ binding: null }), 'VIEWER');

    expect((await app.inject({ method: 'PUT', url, payload: body })).statusCode).toBe(403);
  });
});

describe('DELETE /experiments/:id/metric-binding', () => {
  it('remove só dentro do workspace', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    const res = await app.inject({ method: 'DELETE', url });

    expect(res.statusCode).toBe(204);
    expect(prisma.metricBinding.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, experimentId: EXPERIMENT_ID },
    });
  });

  it('nega VIEWER', async () => {
    const app = await buildApp(prismaFake(), 'VIEWER');

    expect((await app.inject({ method: 'DELETE', url })).statusCode).toBe(403);
  });
});

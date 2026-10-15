import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { getAgentRunRoute } from './get-agent-run.controller.js';

const RUN = {
  id: '11111111-1111-4111-8111-111111111111',
  taskType: 'summarize-business-context',
  agentType: 'context-analyst',
  status: 'COMPLETED',
  input: { businessId: '22222222-2222-4222-8222-222222222222' },
  output: { summary: 'ok' },
  error: null,
  model: 'deepseek-chat',
  estimatedCost: 0.0002,
  createdAt: new Date('2026-07-27T12:00:00Z'),
  completedAt: new Date('2026-07-27T12:00:10Z'),
};

async function buildTestApp(findFirst: ReturnType<typeof vi.fn>) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', { agentRun: { findFirst } } as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'o1', workspaceId: 'ws-1', role: 'OWNER' };
  });
  await app.register(getAgentRunRoute);
  return app;
}

describe('GET /agent-runs/:id', () => {
  it('returns the run of the caller workspace', async () => {
    const findFirst = vi.fn().mockResolvedValue(RUN);
    const app = await buildTestApp(findFirst);

    const res = await app.inject({ method: 'GET', url: `/agent-runs/${RUN.id}` });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('COMPLETED');
    // Dinheiro é auditoria interna: o cliente conta em créditos.
    expect(res.payload).not.toContain('estimatedCost');
    expect(findFirst.mock.calls[0]![0].where.workspaceId).toBe('ws-1');
  });

  it('returns the run input, so a caller can tell what the run reasoned about', async () => {
    // O client (a UI) precisa nomear o goal de um run sem adivinhar: o input
    // gravado é a única fonte confiável para isso, já que o body do pedido
    // original nunca fica disponível de outra forma.
    const findFirst = vi.fn().mockResolvedValue(RUN);
    const app = await buildTestApp(findFirst);

    const res = await app.inject({ method: 'GET', url: `/agent-runs/${RUN.id}` });

    expect(res.json().input).toEqual(RUN.input);
  });

  it('answers 404 for a run of another workspace', async () => {
    const app = await buildTestApp(vi.fn().mockResolvedValue(null));

    const res = await app.inject({ method: 'GET', url: `/agent-runs/${RUN.id}` });

    expect(res.statusCode).toBe(404);
  });

  it('rejects an id that is not a uuid', async () => {
    const app = await buildTestApp(vi.fn());

    const res = await app.inject({ method: 'GET', url: '/agent-runs/abc' });

    expect(res.statusCode).toBe(400);
  });
});

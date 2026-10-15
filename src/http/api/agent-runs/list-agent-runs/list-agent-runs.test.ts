import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { listAgentRunsRoute } from './list-agent-runs.controller.js';

const RUN = {
  id: 'run-1',
  taskType: 'propose-strategies',
  agentType: 'strategy-analyst',
  status: 'RUNNING',
  input: { goalId: '33333333-3333-4333-8333-333333333333' },
  output: null,
  error: null,
  model: null,
  createdAt: new Date('2026-07-28T12:00:00Z'),
  completedAt: null,
};

const findMany = vi.fn();

async function buildApp() {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', { agentRun: { findMany: findMany.mockResolvedValue([RUN]) } } as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: 'ws-1', role: 'MEMBER' };
  });
  await app.register(listAgentRunsRoute);
  return app;
}

describe('GET /agent-runs', () => {
  it('lists this workspace runs, newest first', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/agent-runs' });

    expect(res.statusCode).toBe(200);
    expect(res.json().runs).toHaveLength(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'ws-1' }, orderBy: { createdAt: 'desc' }, take: 20 }),
    );
  });

  it('includes each run\'s input, so a caller can tell what it reasoned about', async () => {
    // A recovered run is adopted by id alone; naming what it was about (a
    // goal, a business) has nowhere else to come from but the stored input.
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/agent-runs' });

    expect(res.json().runs[0].input).toEqual(RUN.input);
  });

  it('filters by task type and status server-side', async () => {
    // O cliente pergunta "existe um run de proposta em andamento?" — filtrar no
    // browser significaria baixar runs de outras tarefas para descartá-los.
    const app = await buildApp();

    await app.inject({ method: 'GET', url: '/agent-runs?taskType=propose-strategies&status=RUNNING' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'ws-1', taskType: 'propose-strategies', status: 'RUNNING' },
      }),
    );
  });

  it('caps the page size at fifty', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/agent-runs?limit=500' });

    expect(res.statusCode).toBe(400);
  });

  it('rejects a status outside the enum', async () => {
    const app = await buildApp();

    expect((await app.inject({ method: 'GET', url: '/agent-runs?status=NOPE' })).statusCode).toBe(400);
  });
});

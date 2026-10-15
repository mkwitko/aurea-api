import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../../lib/errors.js';
import { denyReadOnly } from '../../../../plugins/tenant.js';
import { getDashboardRoute } from './get-dashboard.controller.js';

const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';

const EMPTY = {
  business: { findFirst: vi.fn().mockResolvedValue(null) },
  icp: { count: vi.fn().mockResolvedValue(0) },
  goal: { count: vi.fn().mockResolvedValue(0), findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
  agentRun: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
  strategy: { count: vi.fn().mockResolvedValue(0), findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
  hypothesis: { count: vi.fn().mockResolvedValue(0) },
  experiment: { findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
  outcome: { findMany: vi.fn().mockResolvedValue([]) },
  learning: { findMany: vi.fn().mockResolvedValue([]) },
  businessContext: { findUnique: vi.fn().mockResolvedValue(null) },
};

function prismaFake(overrides: Partial<typeof EMPTY> = {}) {
  return { ...EMPTY, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

async function buildApp(prisma: unknown, role: 'OWNER' | 'MEMBER' | 'VIEWER' = 'MEMBER') {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prisma as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: WORKSPACE_ID, role };
  });
  // The real guard, not a copy of it — the point of the read-only test below.
  app.addHook('preHandler', denyReadOnly);
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
    throw error;
  });
  await app.register(getDashboardRoute);
  return app;
}

describe('GET /dashboard', () => {
  it('sends an empty workspace to setting up the business', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({ method: 'GET', url: '/dashboard' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stage).toBe('BUSINESS');
    expect(body.nextAction.kind).toBe('SET_UP_BUSINESS');
    expect(body.setup).toMatchObject({ business: false, completed: 0, total: 8 });
    // No loop to describe yet — the client should not have to infer that.
    expect(body.loop).toBeNull();
    expect(body.recent).toEqual([]);
  });

  it('ignores a business and an ICP the founder deleted', async () => {
    // Sem o filtro, o fundador exclui o negócio e a home continua dizendo que
    // a etapa está feita — foi exatamente o que aconteceu em produção. Business
    // e Icp são soft delete; Goal não tem a coluna, seu ciclo é o status.
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    await app.inject({ method: 'GET', url: '/dashboard' });

    expect(prisma.business.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: WORKSPACE_ID, deletedAt: null } }),
    );
    expect(prisma.icp.count).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, deletedAt: null },
    });
  });

  it('asks for a goal again once every one is paused, finished or cancelled', async () => {
    // Um objetivo pausado ou cancelado não é um objetivo que o fundador tem.
    // Contar todos deixava a home dizendo que a etapa estava feita para quem
    // não tinha nenhum número em aberto para perseguir.
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    await app.inject({ method: 'GET', url: '/dashboard' });

    expect(prisma.goal.count).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, status: { in: ['DRAFT', 'ACTIVE'] } },
    });
  });

  it('describes the loop once setup is complete', async () => {
    const app = await buildApp(
      prismaFake({
        business: { findFirst: vi.fn().mockResolvedValue({ id: 'b1' }) },
        icp: { count: vi.fn().mockResolvedValue(1) },
        goal: {
          count: vi.fn().mockResolvedValue(1),
          findFirst: vi.fn().mockResolvedValue({ id: 'g1', name: '30 trials', metric: 'signups', targetValue: 30, unit: 'signups' }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        agentRun: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([]) },
        strategy: {
          count: vi.fn().mockResolvedValue(1),
          findFirst: vi.fn().mockResolvedValue({ id: 's1', name: 'founder-led outbound' }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        hypothesis: { count: vi.fn().mockResolvedValue(1) },
        businessContext: {
          findUnique: vi.fn().mockResolvedValue({
            currentVersion: { data: { icp: { notes: 'x' }, offer: { notes: 'y' }, market: { notes: 'z' } } },
          }),
        },
        experiment: {
          // Only one call happens through this mock: `snapshot()`'s
          // `experiment.findFirst`. `loopContext()` no longer issues a second
          // `experiment.findFirst` to resolve the spine's strategyId — it
          // reads `spine.strategyId` directly (Task 3 fix round).
          findFirst: vi.fn().mockResolvedValue({
            id: 'e1',
            name: 'LinkedIn DM test',
            status: 'COMPLETED',
            metric: 'replies',
            endDate: null,
            strategyId: 's1',
            _count: { outcomes: 0 },
            learnings: [],
          }),
          count: vi.fn().mockResolvedValue(1),
          findMany: vi.fn().mockResolvedValue([]),
        },
      }),
    );

    const res = await app.inject({ method: 'GET', url: '/dashboard' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stage).toBe('OUTCOME');
    expect(body.nextAction).toMatchObject({ kind: 'RECORD_OUTCOME', experimentId: 'e1', subjectLabel: 'LinkedIn DM test' });
    expect(body.loop).toMatchObject({ number: 1, strategy: { id: 's1' }, experiment: { id: 'e1', status: 'COMPLETED' } });
    expect(body.loop.rail).toEqual([
      { node: 'STRATEGY', state: 'DONE' },
      { node: 'EXPERIMENT', state: 'DONE' },
      { node: 'OUTCOME', state: 'CURRENT' },
      { node: 'LEARNING', state: 'TODO' },
    ]);
  });

  it('serves a read-only member', async () => {
    // Reading where the loop stands is not a write. denyReadOnly returns early
    // on GET; this pins that so a later refactor cannot make this endpoint
    // write without a failing test.
    const app = await buildApp(prismaFake(), 'VIEWER');

    const res = await app.inject({ method: 'GET', url: '/dashboard' });

    expect(res.statusCode).toBe(200);
  });

  it('never sends display copy — only enums, ids and what the founder typed', async () => {
    const app = await buildApp(prismaFake());

    const body = await app.inject({ method: 'GET', url: '/dashboard' }).then((r) => r.json());

    // Spec §3.4. A sentence here cannot be translated into PT or ES.
    expect(JSON.stringify(body)).not.toMatch(/[Ss]et up your|Record the|Loading/);
    expect(body).not.toHaveProperty('nextAction.href');
  });
});

type PendingRow = { id: string; name: string; metric: string; endDate: Date | null };

/**
 * `experiment.count` e `experiment.findMany` são usados por duas perguntas
 * diferentes — o snapshot conta experimentos sem filtro de status e lista os
 * recentes; a medição pendente conta e lista COMPLETED sem outcome. Uma
 * implementação só, ramificando pelo `where`, mantém os dois significados em vez
 * de fazer um valor fixo responder pelos dois.
 */
function pendingPrisma(count: number, rows: PendingRow[]) {
  const isPending = (args: { where?: { status?: string } } | undefined) => args?.where?.status === 'COMPLETED';
  return prismaFake({
    experiment: {
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockImplementation((args) => Promise.resolve(isPending(args) ? count : 0)),
      findMany: vi.fn().mockImplementation((args) => Promise.resolve(isPending(args) ? rows : [])),
    },
  });
}

describe('GET /dashboard — medição pendente', () => {
  // Um experimento COMPLETED sem nenhum outcome é o loop parado esperando o
  // fundador: o relógio já fechou o teste e o número não chegou.
  it('conta os experimentos completados que ainda não têm número', async () => {
    const prisma = pendingPrisma(3, [
      { id: 'e1', name: 'Landing A/B', metric: 'conversion_rate', endDate: new Date('2026-08-01T00:00:00.000Z') },
    ]);
    const app = await buildApp(prisma);

    const res = await app.inject({ method: 'GET', url: '/dashboard' });

    expect(res.statusCode).toBe(200);
    expect(res.json().pendingMeasurement.count).toBe(3);
    expect(res.json().pendingMeasurement.items).toEqual([
      {
        experimentId: 'e1',
        name: 'Landing A/B',
        metric: 'conversion_rate',
        endDate: '2026-08-01T00:00:00.000Z',
      },
    ]);
  });

  // `count` carrega a verdade e `items` é uma janela: um corte silencioso leria
  // como "é só isso" (spec §4.2).
  it('devolve a contagem real ao lado da janela de itens', async () => {
    const rows: PendingRow[] = Array.from({ length: 5 }, (_, i) => ({
      id: `e${i}`,
      name: `Teste ${i}`,
      metric: 'signups',
      endDate: null,
    }));
    const app = await buildApp(pendingPrisma(12, rows));

    const res = await app.inject({ method: 'GET', url: '/dashboard' });

    expect(res.json().pendingMeasurement.count).toBe(12);
    expect(res.json().pendingMeasurement.items).toHaveLength(5);
  });

  it('devolve zero e lista vazia quando nada está esperando número', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({ method: 'GET', url: '/dashboard' });

    expect(res.json().pendingMeasurement).toEqual({ count: 0, items: [] });
  });

  // Sem o filtro de outcomes, um experimento já medido continuaria sendo
  // cobrado; sem o workspace, o dashboard mostraria o experimento de outro
  // cliente. O `take: 5` entra na mesma asserção porque é o que sustenta o
  // "+N" da tela.
  it('pergunta pelos completados sem outcome, dentro do workspace', async () => {
    const prisma = pendingPrisma(0, []);
    const app = await buildApp(prisma);

    await app.inject({ method: 'GET', url: '/dashboard' });

    const where = { workspaceId: WORKSPACE_ID, status: 'COMPLETED', outcomes: { none: {} } };
    expect(prisma.experiment.count).toHaveBeenCalledWith({ where });
    expect(prisma.experiment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where, take: 5 }));
  });
});

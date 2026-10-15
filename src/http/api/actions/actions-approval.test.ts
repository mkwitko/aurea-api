import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../lib/errors.js';
import { actionsRoutes } from './index.js';

const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';
const ACTION_ID = '33333333-3333-3333-3333-333333333333';

const PAYLOAD = { content: 'Como cortamos 30% do custo operacional.' };

/** Um alvo, porque toda resposta de ação leva os alvos (spec §4.1). */
const TARGET = {
  id: 'tgt-1',
  workspaceId: WORKSPACE_ID,
  actionId: ACTION_ID,
  platform: 'LINKEDIN',
  socialAccountId: 'acc-li',
  status: 'PENDING',
  externalId: null,
  postUrl: null,
  lastError: null,
  failureKind: null,
  attempts: 0,
  publishedAt: null,
  createdAt: new Date('2026-08-05T10:00:00.000Z'),
  updatedAt: new Date('2026-08-05T10:00:00.000Z'),
};

const ACTION = {
  id: ACTION_ID,
  workspaceId: WORKSPACE_ID,
  experimentId: null,
  type: 'SOCIAL_POST',
  name: 'Post sobre custo operacional',
  description: null,
  payload: PAYLOAD,
  status: 'PROPOSED',
  createdBy: 'u1',
  approvedAt: null,
  executedAt: null,
  providerPostId: null,
  heartbeatAt: null,
  targets: [TARGET],
  createdAt: new Date('2026-08-04T10:00:00.000Z'),
  updatedAt: new Date('2026-08-04T10:00:00.000Z'),
};

/**
 * `'action' in over`, e não `??`: os casos que passam `null` de propósito
 * (ação de outro workspace) exigem que o null chegue — com `??` o default
 * voltaria e o 404 passaria sem existir.
 *
 * `$transaction` executa o callback contra o mesmo objeto: submeter e rever
 * escrevem duas tabelas de uma vez, e um fake que não passasse por isso
 * deixaria o par sem cobertura.
 */
function prismaFake(over: { action?: unknown } = {}) {
  const db = {
    action: {
      findFirst: vi.fn().mockResolvedValue('action' in over ? over.action : ACTION),
      findMany: vi.fn().mockResolvedValue([ACTION]),
      create: vi.fn(),
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...ACTION, ...data })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    approval: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'ap-1' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    // O ciclo de aprovação não escreve alvo nenhum; os mocks existem para o
    // teste poder afirmar exatamente isso.
    actionTarget: {
      findMany: vi.fn().mockResolvedValue([TARGET]),
      findFirst: vi.fn().mockResolvedValue(TARGET),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    externalReference: { findFirst: vi.fn().mockResolvedValue(null) },
    experiment: { findFirst: vi.fn().mockResolvedValue(null) },
    workspaceIntegration: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  return { ...db, $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)) };
}

beforeEach(() => vi.clearAllMocks());

async function buildApp(prisma: unknown, role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' = 'ADMIN') {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prisma as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u2', organizationId: 'org-1', workspaceId: WORKSPACE_ID, role };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, details: error.details } });
    }
    throw error;
  });
  await app.register(actionsRoutes, {});
  return app;
}

describe('POST /actions/:id/submit', () => {
  it('move para PENDING_APPROVAL e abre um Approval pendente', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/submit` });

    expect(res.statusCode).toBe(200);
    expect(res.json().action.status).toBe('PENDING_APPROVAL');
    expect(prisma.approval.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: WORKSPACE_ID,
          actionId: ACTION_ID,
          requestedBy: 'u2',
          status: 'PENDING',
        }),
      }),
    );
    // O par vai numa transação: um Approval pendente sobre uma ação que ficou
    // em PROPOSED seria um pedido que ninguém vê.
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('recusa submeter o que já está submetido', async () => {
    const app = await buildApp(prismaFake({ action: { ...ACTION, status: 'PENDING_APPROVAL' } }));

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/submit` });

    expect(res.statusCode).toBe(400);
  });

  it('uma ação de outro workspace é indistinguível de inexistente', async () => {
    const app = await buildApp(prismaFake({ action: null }));

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/submit` });

    expect(res.statusCode).toBe(404);
  });

  it('VIEWER não submete', async () => {
    const app = await buildApp(prismaFake(), 'VIEWER');

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/submit` });

    expect(res.statusCode).toBe(403);
  });

  it('MEMBER submete', async () => {
    const app = await buildApp(prismaFake(), 'MEMBER');

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/submit` });

    expect(res.statusCode).toBe(200);
  });
});

describe('POST /actions/:id/approve', () => {
  const pending = () => prismaFake({ action: { ...ACTION, status: 'PENDING_APPROVAL' } });

  it('aprova, carimba approvedAt e fecha o Approval com o revisor', async () => {
    const prisma = pending();
    const app = await buildApp(prisma);

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/approve` });

    expect(res.statusCode).toBe(200);
    expect(res.json().action).toMatchObject({ status: 'APPROVED' });
    expect(res.json().action.approvedAt).not.toBeNull();
    expect(prisma.approval.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // Só o pendente: aprovar de novo não pode reescrever a decisão de
        // ontem, que é histórico.
        where: { workspaceId: WORKSPACE_ID, actionId: ACTION_ID, status: 'PENDING' },
        data: expect.objectContaining({ status: 'APPROVED', reviewedBy: 'u2' }),
      }),
    );
  });

  /**
   * O autor pode aprovar o que escreveu — em workspace de fundador solo, exigir
   * um segundo par de olhos travaria o piloto (spec §2, decisão 4). O que não
   * pode é acontecer no mesmo request que criou, e isso está garantido por não
   * existir rota que faça as duas coisas.
   */
  it('o autor pode aprovar a própria ação', async () => {
    const prisma = prismaFake({ action: { ...ACTION, status: 'PENDING_APPROVAL', createdBy: 'u2' } });
    const app = await buildApp(prisma);

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/approve` });

    expect(res.statusCode).toBe(200);
  });

  it('recusa aprovar o que não foi submetido', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/approve` });

    expect(res.statusCode).toBe(400);
  });

  // Aprovar autoriza a saída; não publica nem toca alvo nenhum. Quem move alvo é
  // a execução, e são dois atos separados (spec §7).
  it('aprovar não mexe em alvo nenhum', async () => {
    const prisma = pending();
    const app = await buildApp(prisma);

    await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/approve` });

    expect(prisma.actionTarget.update).not.toHaveBeenCalled();
    expect(prisma.actionTarget.updateMany).not.toHaveBeenCalled();
    expect(prisma.actionTarget.createMany).not.toHaveBeenCalled();
    expect(prisma.actionTarget.deleteMany).not.toHaveBeenCalled();
  });

  // Aprovar é o ato que autoriza sair para o mundo: MEMBER escreve, não autoriza.
  it('MEMBER não aprova', async () => {
    const app = await buildApp(pending(), 'MEMBER');

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/approve` });

    expect(res.statusCode).toBe(403);
  });

  it('VIEWER não aprova', async () => {
    const app = await buildApp(pending(), 'VIEWER');

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/approve` });

    expect(res.statusCode).toBe(403);
  });
});

describe('POST /actions/:id/reject', () => {
  const pending = () => prismaFake({ action: { ...ACTION, status: 'PENDING_APPROVAL' } });

  it('devolve para PROPOSED com o comentário no Approval', async () => {
    const prisma = pending();
    const app = await buildApp(prisma);

    const res = await app.inject({
      method: 'POST',
      url: `/actions/${ACTION_ID}/reject`,
      payload: { comment: 'Trocar o número: 30% não é o que medimos.' },
    });

    expect(res.statusCode).toBe(200);
    // Volta editável, e não morre: o fundador corrige e submete de novo.
    expect(res.json().action.status).toBe('PROPOSED');
    expect(prisma.approval.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'REJECTED',
          reviewedBy: 'u2',
          comment: 'Trocar o número: 30% não é o que medimos.',
        }),
      }),
    );
  });

  // Uma rejeição sem motivo devolve o trabalho ao autor sem dizer o que corrigir.
  it('recusa rejeitar sem comentário', async () => {
    const app = await buildApp(pending());

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/reject`, payload: {} });

    expect(res.statusCode).toBe(400);
  });

  it('recusa comentário vazio', async () => {
    const app = await buildApp(pending());

    const res = await app.inject({
      method: 'POST',
      url: `/actions/${ACTION_ID}/reject`,
      payload: { comment: '   ' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('MEMBER não rejeita', async () => {
    const app = await buildApp(pending(), 'MEMBER');

    const res = await app.inject({
      method: 'POST',
      url: `/actions/${ACTION_ID}/reject`,
      payload: { comment: 'não' },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('POST /actions/:id/cancel', () => {
  it('cancela uma ação proposta', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/cancel` });

    expect(res.statusCode).toBe(200);
    expect(res.json().action.status).toBe('CANCELLED');
  });

  it('cancela uma ação aprovada que ainda não saiu', async () => {
    const app = await buildApp(prismaFake({ action: { ...ACTION, status: 'APPROVED' } }));

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/cancel` });

    expect(res.statusCode).toBe(200);
  });

  /**
   * Cancelar não despublica nada. Deixar o status virar CANCELLED depois de
   * entregue faria a tela mentir sobre o que existe no mundo.
   */
  it('recusa cancelar o que já foi executado', async () => {
    const app = await buildApp(prismaFake({ action: { ...ACTION, status: 'EXECUTED' } }));

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/cancel` });

    expect(res.statusCode).toBe(400);
  });

  // Em voo: quem tira do EXECUTING é o processor ou o reaper, nunca uma rota.
  it('recusa cancelar o que está em execução', async () => {
    const app = await buildApp(prismaFake({ action: { ...ACTION, status: 'EXECUTING' } }));

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/cancel` });

    expect(res.statusCode).toBe(400);
  });

  it('VIEWER não cancela', async () => {
    const app = await buildApp(prismaFake(), 'VIEWER');

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/cancel` });

    expect(res.statusCode).toBe(403);
  });
});

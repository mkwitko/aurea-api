import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../lib/errors.js';
import { actionsRoutes } from './index.js';

const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';
const ACTION_ID = '33333333-3333-3333-3333-333333333333';
const TARGET_ID = '44444444-4444-4444-4444-444444444444';
const OTHER_TARGET_ID = '55555555-5555-5555-5555-555555555555';

const PAYLOAD = { content: 'texto do post' };

const target = (over: Record<string, unknown> = {}) => ({
  id: TARGET_ID,
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
  ...over,
});

const action = (over: Record<string, unknown> = {}) => ({
  id: ACTION_ID,
  workspaceId: WORKSPACE_ID,
  experimentId: null,
  type: 'SOCIAL_POST',
  name: 'Post',
  description: null,
  payload: PAYLOAD,
  status: 'APPROVED',
  createdBy: 'u1',
  approvedAt: new Date('2026-08-05T10:30:00.000Z'),
  executedAt: null,
  providerPostId: null,
  heartbeatAt: null,
  createdAt: new Date('2026-08-05T10:00:00.000Z'),
  updatedAt: new Date('2026-08-05T10:00:00.000Z'),
  targets: [target()],
  ...over,
});

const INTEGRATION = {
  id: 'int-social',
  workspaceId: WORKSPACE_ID,
  provider: 'POST_FOR_ME',
  externalId: `ws-${WORKSPACE_ID}`,
};

function prismaFake(
  over: { action?: unknown; claimed?: number; integration?: unknown; target?: unknown } = {},
) {
  const current = 'action' in over ? over.action : action();
  const targets = (current as { targets?: unknown[] } | null)?.targets ?? [];
  const db = {
    action: {
      findFirst: vi.fn().mockResolvedValue(current),
      findFirstOrThrow: vi.fn().mockResolvedValue(current),
      findMany: vi.fn().mockResolvedValue([current]),
      create: vi.fn(),
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
        ...(current as object),
        ...data,
      })),
      updateMany: vi.fn().mockResolvedValue({ count: 'claimed' in over ? over.claimed : 1 }),
    },
    actionTarget: {
      findMany: vi.fn().mockResolvedValue(targets),
      findFirst: vi.fn().mockResolvedValue('target' in over ? over.target : target()),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn().mockResolvedValue(target()),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn().mockResolvedValue(0),
    },
    approval: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), updateMany: vi.fn() },
    externalReference: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    experiment: { findFirst: vi.fn().mockResolvedValue(null) },
    workspaceIntegration: {
      findFirst: vi.fn().mockResolvedValue('integration' in over ? over.integration : INTEGRATION),
    },
  };
  return { ...db, $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)) };
}

beforeEach(() => vi.clearAllMocks());

async function buildApp(
  prisma: unknown,
  opts: { role?: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER'; enqueue?: ReturnType<typeof vi.fn> } = {},
) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prisma as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = {
      userId: 'u2',
      organizationId: 'org-1',
      workspaceId: WORKSPACE_ID,
      role: opts.role ?? 'ADMIN',
    };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, details: error.details } });
    }
    throw error;
  });
  // A fila entra por opção: sem isso o teste abriria conexão com o Redis.
  await app.register(actionsRoutes, { enqueue: opts.enqueue ?? vi.fn() });
  return app;
}

describe('POST /actions/:id/execute', () => {
  it('reivindica a execução e enfileira, respondendo 202', async () => {
    const prisma = prismaFake();
    const enqueue = vi.fn();
    const app = await buildApp(prisma, { enqueue });

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/execute` });

    expect(res.statusCode).toBe(202);
    expect(res.json().action.status).toBe('EXECUTING');
    // Os dois ids no job: o `workspaceId` é a fronteira que o processor
    // reconfere, porque a chave do provider é a mesma para todos (spec §5.1).
    expect(enqueue).toHaveBeenCalledWith({ actionId: ACTION_ID, workspaceId: WORKSPACE_ID });
  });

  it('marca os alvos publicáveis como em voo', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/execute` });

    expect(prisma.actionTarget.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PUBLISHING', attempts: { increment: 1 } }),
      }),
    );
  });

  it('move de APPROVED numa escrita condicional', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/execute` });

    expect(prisma.action.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // A transição é a própria condição: dois cliques simultâneos não podem
        // ambos encontrar um estado executável.
        where: expect.objectContaining({
          id: ACTION_ID,
          workspaceId: WORKSPACE_ID,
          // `DELIVERY_UNKNOWN` saiu: sem endpoint de retry, executar de um alvo
          // incerto é um segundo envio às cegas (spec de migração §2.5).
          status: { in: ['APPROVED', 'PARTIALLY_EXECUTED', 'FAILED'] },
        }),
        data: expect.objectContaining({ status: 'EXECUTING' }),
      }),
    );
  });

  it('reexecuta uma ação em PARTIALLY_EXECUTED', async () => {
    const prisma = prismaFake({
      action: action({
        status: 'PARTIALLY_EXECUTED',
        providerPostId: 'post_1',
        targets: [
          target({ status: 'PUBLISHED', externalId: 'post_1' }),
          target({ id: OTHER_TARGET_ID, platform: 'X', status: 'FAILED' }),
        ],
      }),
    });
    const app = await buildApp(prisma);

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/execute` });

    expect(res.statusCode).toBe(202);
  });

  /**
   * Nada publicável: o que sobrou já publicou ou é incerto, e um envio novo
   * criaria post duplicado. A recusa vem **antes** do CAS — reverter um CAS já
   * feito exigiria uma segunda escrita, que pode falhar e deixaria a ação presa em
   * `EXECUTING`.
   */
  it('recusa quando não há nada a publicar, sem reivindicar nem enfileirar', async () => {
    const prisma = prismaFake({
      action: action({
        status: 'PARTIALLY_EXECUTED',
        providerPostId: 'post_1',
        targets: [
          target({ status: 'PUBLISHED', externalId: 'post_1' }),
          target({ id: OTHER_TARGET_ID, platform: 'X', status: 'DELIVERY_UNKNOWN' }),
        ],
      }),
    });
    const enqueue = vi.fn();
    const app = await buildApp(prisma, { enqueue });

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/execute` });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('AUR-T0051');
    expect(prisma.action.updateMany).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  /**
   * Retentar de uma entrega incerta deixou de ser legal na migração: a Post for Me
   * não tem endpoint de retry, então não existe id que ela reconheça para retentar
   * só o que falhou. A saída é humana, alvo por alvo (spec de migração §2.5).
   */
  it('recusa executar uma ação com entrega incerta', async () => {
    const prisma = prismaFake({
      action: action({
        status: 'DELIVERY_UNKNOWN',
        providerPostId: 'post_1',
        targets: [target({ status: 'DELIVERY_UNKNOWN' })],
      }),
    });
    const enqueue = vi.fn();
    const app = await buildApp(prisma, { enqueue });

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/execute` });

    expect(res.statusCode).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('recusa executar sem rede conectada, sem enfileirar', async () => {
    const prisma = prismaFake({ integration: null });
    const enqueue = vi.fn();
    const app = await buildApp(prisma, { enqueue });

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/execute` });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AUR-T0046');
    expect(enqueue).not.toHaveBeenCalled();
  });

  // Executar sem aprovação é a coisa que este sistema existe para impedir.
  it('recusa executar o que não foi aprovado', async () => {
    const app = await buildApp(prismaFake({ action: action({ status: 'PROPOSED' }) }));

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/execute` });

    expect(res.statusCode).toBe(400);
  });

  // Perdeu a corrida do compare-and-swap: nada vai para a fila, senão a segunda
  // publicação sairia.
  it('não enfileira quando o compare-and-swap perde', async () => {
    const prisma = prismaFake({ claimed: 0 });
    const enqueue = vi.fn();
    const app = await buildApp(prisma, { enqueue });

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/execute` });

    expect(res.statusCode).toBe(409);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('MEMBER não executa', async () => {
    const app = await buildApp(prismaFake(), { role: 'MEMBER' });

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/execute` });

    expect(res.statusCode).toBe(403);
  });

  it('uma ação de outro workspace é indistinguível de inexistente', async () => {
    const app = await buildApp(prismaFake({ action: null }));

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/execute` });

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /actions/:id/targets/:targetId/resolve', () => {
  const unknown = (over: Record<string, unknown> = {}) =>
    prismaFake({
      action: action({ status: 'DELIVERY_UNKNOWN', targets: [target({ status: 'DELIVERY_UNKNOWN' })] }),
      target: target({ status: 'DELIVERY_UNKNOWN' }),
      ...over,
    });

  const url = `/actions/${ACTION_ID}/targets/${TARGET_ID}/resolve`;

  it('publicou: marca o alvo publicado e grava a proveniência com o id informado', async () => {
    const prisma = unknown();
    const app = await buildApp(prisma);

    const res = await app.inject({ method: 'POST', url, payload: { outcome: 'PUBLISHED', externalId: 'post_1' } });

    expect(res.statusCode).toBe(200);
    expect(prisma.externalReference.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: 'SOCIAL_POST_TARGET',
        entityId: TARGET_ID,
        externalId: 'post_1',
      }),
    });
    expect(prisma.actionTarget.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PUBLISHED' }) }),
    );
  });

  /**
   * Sem id, nada de proveniência: um id inventado seria proveniência falsa de um
   * post real, e proveniência ausente é melhor que proveniência de mentira.
   */
  it('publicou sem id: marca o alvo publicado e não grava referência', async () => {
    const prisma = unknown();
    const app = await buildApp(prisma);

    const res = await app.inject({ method: 'POST', url, payload: { outcome: 'PUBLISHED' } });

    expect(res.statusCode).toBe(200);
    expect(prisma.externalReference.create).not.toHaveBeenCalled();
    expect(prisma.actionTarget.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PUBLISHED', externalId: null }) }),
    );
  });

  /**
   * Não publicou: o alvo volta para `PENDING`, e é isso que torna o retry seguro —
   * ele deixou de ser incerto porque um humano olhou a rede (spec §8.3).
   */
  it('não publicou: devolve o alvo para PENDING', async () => {
    const prisma = unknown();
    const app = await buildApp(prisma);

    const res = await app.inject({ method: 'POST', url, payload: { outcome: 'NOT_PUBLISHED' } });

    expect(res.statusCode).toBe(200);
    expect(prisma.actionTarget.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING', lastError: null, failureKind: null }),
      }),
    );
    expect(prisma.externalReference.create).not.toHaveBeenCalled();
  });

  it('recusa resolver um alvo que não está incerto', async () => {
    const prisma = prismaFake({ target: target({ status: 'PUBLISHED', externalId: 'post_1' }) });
    const app = await buildApp(prisma);

    const res = await app.inject({ method: 'POST', url, payload: { outcome: 'PUBLISHED' } });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('AUR-T0044');
  });

  // Os três ids sempre juntos: um alvo que existe mas é de outra ação lê como
  // ausente.
  it('um alvo de outra ação é indistinguível de inexistente', async () => {
    const prisma = unknown({ target: null });
    const app = await buildApp(prisma);

    const res = await app.inject({ method: 'POST', url, payload: { outcome: 'PUBLISHED' } });

    expect(res.statusCode).toBe(404);
    expect(prisma.actionTarget.findFirst).toHaveBeenCalledWith({
      where: { id: TARGET_ID, actionId: ACTION_ID, workspaceId: WORKSPACE_ID },
    });
  });

  it('MEMBER não resolve', async () => {
    const app = await buildApp(unknown(), { role: 'MEMBER' });

    const res = await app.inject({ method: 'POST', url, payload: { outcome: 'PUBLISHED' } });

    expect(res.statusCode).toBe(403);
  });

  it('recusa um outcome fora do vocabulário', async () => {
    const app = await buildApp(unknown());

    const res = await app.inject({ method: 'POST', url, payload: { outcome: 'MAYBE' } });

    expect(res.statusCode).toBe(400);
  });
});

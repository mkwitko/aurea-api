import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../lib/errors.js';
import { seal } from '../../../billing/crypto.js';
import { SocialProviderError } from '../../../integrations/social/index.js';
import { actionsRoutes } from './index.js';

const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';
const ACTION_ID = '33333333-3333-3333-3333-333333333333';
const EXPERIMENT_ID = '44444444-4444-4444-4444-444444444444';
const EXTERNAL_ID = `ws-${WORKSPACE_ID}`;

// A chave é da conta AUREA, então a linha guarda um objeto vazio selado (spec §5).
const SEALED = seal(JSON.stringify({}));

const INTEGRATION = {
  id: 'int-social',
  workspaceId: WORKSPACE_ID,
  provider: 'POST_FOR_ME',
  authKind: 'ACCOUNT_KEY',
  ciphertext: new Uint8Array(SEALED.ciphertext),
  iv: new Uint8Array(SEALED.iv),
  authTag: new Uint8Array(SEALED.authTag),
  externalId: EXTERNAL_ID,
  accountLabel: 'Post for Me',
  status: 'OK',
  lastCheckedAt: new Date('2026-08-05T00:00:00.000Z'),
  lastError: null,
  createdBy: 'u1',
  createdAt: new Date('2026-08-05T00:00:00.000Z'),
  updatedAt: new Date('2026-08-05T00:00:00.000Z'),
};

const PAYLOAD = { content: 'Como cortamos 30% do custo operacional.' };

const target = (over: Record<string, unknown> = {}) => ({
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
  ...over,
});

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
  createdAt: new Date('2026-08-05T10:00:00.000Z'),
  updatedAt: new Date('2026-08-05T10:00:00.000Z'),
  targets: [target()],
};

const ACCOUNTS = [
  { id: 'acc-li', platform: 'LINKEDIN', username: 'acme', pictureUrl: null, connected: true },
  { id: 'acc-x', platform: 'X', username: 'acme_x', pictureUrl: null, connected: true },
];

/**
 * `'key' in over`, e não `??`: os casos negativos passam `null` de propósito
 * (ação de outro workspace, nada conectado), e `??` devolveria o default de
 * qualquer jeito — o teste passaria sem que a recusa existisse.
 */
function prismaFake(over: { action?: unknown; integration?: unknown; experiment?: unknown } = {}) {
  const action = {
    findFirst: vi.fn().mockResolvedValue('action' in over ? over.action : ACTION),
    findFirstOrThrow: vi.fn().mockResolvedValue('action' in over ? over.action : ACTION),
    findMany: vi.fn().mockResolvedValue([ACTION]),
    create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...ACTION, ...data })),
    update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...ACTION, ...data })),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const actionTarget = {
    findMany: vi.fn().mockResolvedValue([target()]),
    findFirst: vi.fn().mockResolvedValue(target()),
    createMany: vi.fn().mockResolvedValue({ count: 1 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    update: vi.fn().mockResolvedValue(target()),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const approval = {
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findFirst: vi.fn().mockResolvedValue(null),
  };
  const externalReference = { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() };
  const client = {
    action,
    actionTarget,
    approval,
    externalReference,
    experiment: {
      findFirst: vi.fn().mockResolvedValue('experiment' in over ? over.experiment : { id: EXPERIMENT_ID }),
    },
    workspaceIntegration: {
      findFirst: vi.fn().mockResolvedValue('integration' in over ? over.integration : INTEGRATION),
    },
  };
  // A transação roda contra o mesmo fake: o que interessa aos testes é o que foi
  // escrito, e um `tx` separado só duplicaria os mocks.
  return { ...client, $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(client)) };
}

function clientFake(over: Record<string, unknown> = {}) {
  return {
    connectUrl: vi.fn(),
    listAccounts: vi.fn().mockResolvedValue(ACCOUNTS),
    publish: vi.fn(),
    results: vi.fn(),
    disconnect: vi.fn(),
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

async function buildApp(
  prisma: unknown,
  opts: { role?: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER'; social?: ReturnType<typeof clientFake> } = {},
) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prisma as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = {
      userId: 'u1',
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
  const client = opts.social ?? clientFake();
  await app.register(actionsRoutes, { social: () => client as never, enqueue: vi.fn() });
  return app;
}

const newBody = (over: Record<string, unknown> = {}) => ({
  type: 'SOCIAL_POST',
  name: 'Post sobre custo operacional',
  payload: PAYLOAD,
  platforms: ['LINKEDIN'],
  ...over,
});

describe('POST /actions', () => {
  it('cria a ação em PROPOSED, com o autor do request', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    const res = await app.inject({ method: 'POST', url: '/actions', payload: newBody() });

    expect(res.statusCode).toBe(201);
    expect(res.json().action).toMatchObject({ status: 'PROPOSED', name: 'Post sobre custo operacional' });
    expect(prisma.action.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ workspaceId: WORKSPACE_ID, createdBy: 'u1', status: 'PROPOSED' }),
      }),
    );
  });

  /**
   * A recusa acontece antes de existir ação, e não no worker: no worker, um post
   * para várias redes já teria publicado nas outras quando o YouTube falhasse.
   */
  it('recusa criar para uma rede que exige mídia sem mídia', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma, {
      social: clientFake({
        listAccounts: vi
          .fn()
          .mockResolvedValue([{ id: 'acc-tt', platform: 'TIKTOK', username: 'acme', pictureUrl: null, connected: true }]),
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/actions',
      payload: newBody({ platforms: ['TIKTOK'] }),
    });

    expect(res.statusCode).toBe(400);
    expect(prisma.action.create).not.toHaveBeenCalled();
  });

  it('cria um alvo PENDING por rede escolhida', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    await app.inject({
      method: 'POST',
      url: '/actions',
      payload: newBody({ platforms: ['LINKEDIN', 'X'] }),
    });

    // O alvo guarda a conta, não só a rede: é ela que a publicação recebe.
    expect(prisma.actionTarget.createMany).toHaveBeenCalledWith({
      data: [
        { workspaceId: WORKSPACE_ID, actionId: ACTION_ID, platform: 'LINKEDIN', socialAccountId: 'acc-li' },
        { workspaceId: WORKSPACE_ID, actionId: ACTION_ID, platform: 'X', socialAccountId: 'acc-x' },
      ],
    });
  });

  // A rede tem de estar conectada AGORA. Aceitar uma qualquer só falharia na
  // publicação — depois de alguém ter aprovado o texto.
  it('recusa uma rede que não está conectada, e diz qual', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({
      method: 'POST',
      url: '/actions',
      payload: newBody({ platforms: ['FACEBOOK'] }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'AUR-T0047', details: { platform: 'FACEBOOK' } });
  });

  // Publicar numa rede que pede reautenticação falharia. Recusar aqui transforma
  // um erro futuro num aviso presente.
  it('recusa uma rede cuja conta está desconectada', async () => {
    const social = clientFake({
      listAccounts: vi
        .fn()
        .mockResolvedValue([{ id: 'acc-li', platform: 'LINKEDIN', username: 'acme', pictureUrl: null, connected: false }]),
    });
    const app = await buildApp(prismaFake(), { social });

    const res = await app.inject({ method: 'POST', url: '/actions', payload: newBody() });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'AUR-T0047', details: { platform: 'LINKEDIN' } });
  });

  it('recusa criar sem nenhuma rede conectada', async () => {
    const app = await buildApp(prismaFake({ integration: null }));

    const res = await app.inject({ method: 'POST', url: '/actions', payload: newBody() });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AUR-T0046');
  });

  it('devolve o motivo do provider quando a leitura das contas falha', async () => {
    const social = clientFake({
      listAccounts: vi.fn().mockRejectedValue(new SocialProviderError('AUTH', 'Unauthorized', 401)),
    });
    const app = await buildApp(prismaFake(), { social });

    const res = await app.inject({ method: 'POST', url: '/actions', payload: newBody() });

    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatchObject({ code: 'AUR-T0048', details: { reason: 'Unauthorized' } });
  });

  it('recusa rede repetida', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({
      method: 'POST',
      url: '/actions',
      payload: newBody({ platforms: ['LINKEDIN', 'LINKEDIN'] }),
    });

    expect(res.statusCode).toBe(400);
  });

  it('recusa criar sem rede nenhuma', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({ method: 'POST', url: '/actions', payload: newBody({ platforms: [] }) });

    expect(res.statusCode).toBe(400);
  });

  // Instagram e TikTok exigem mídia, e não estão no enum: pedir por eles é 400,
  // não um alvo que nunca publicaria (spec §3.4.1).
  it('recusa uma rede que a AUREA não publica', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({
      method: 'POST',
      url: '/actions',
      payload: newBody({ platforms: ['INSTAGRAM'] }),
    });

    expect(res.statusCode).toBe(400);
  });

  it('aceita vincular a um experimento do mesmo workspace', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    const res = await app.inject({
      method: 'POST',
      url: '/actions',
      payload: newBody({ experimentId: EXPERIMENT_ID }),
    });

    expect(res.statusCode).toBe(201);
    expect(prisma.experiment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: EXPERIMENT_ID, workspaceId: WORKSPACE_ID } }),
    );
  });

  // Um experimento de outro workspace é indistinguível de inexistente.
  it('recusa um experimento que não é do workspace', async () => {
    const app = await buildApp(prismaFake({ experiment: null }));

    const res = await app.inject({
      method: 'POST',
      url: '/actions',
      payload: newBody({ experimentId: EXPERIMENT_ID }),
    });

    expect(res.statusCode).toBe(404);
  });

  // O canal saiu do payload: onde o post vai são os alvos, e um payload com
  // sobras do modelo antigo é contrato velho chegando.
  it('recusa um payload fora do contrato', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({
      method: 'POST',
      url: '/actions',
      payload: newBody({ payload: { content: 'oi', channelId: 'chan-1' } }),
    });

    expect(res.statusCode).toBe(400);
  });

  it('VIEWER não cria', async () => {
    const app = await buildApp(prismaFake(), { role: 'VIEWER' });

    const res = await app.inject({ method: 'POST', url: '/actions', payload: newBody() });

    expect(res.statusCode).toBe(403);
  });

  // MEMBER propõe: é o papel de quem escreve conteúdo (spec §2, decisão 4).
  it('MEMBER cria', async () => {
    const app = await buildApp(prismaFake(), { role: 'MEMBER' });

    const res = await app.inject({ method: 'POST', url: '/actions', payload: newBody() });

    expect(res.statusCode).toBe(201);
  });
});

describe('GET /actions', () => {
  it('lista as ações do workspace, com os alvos', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    const res = await app.inject({ method: 'GET', url: '/actions' });

    expect(res.statusCode).toBe(200);
    expect(res.json().actions).toHaveLength(1);
    expect(res.json().actions[0].targets).toHaveLength(1);
    expect(prisma.action.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: WORKSPACE_ID } }),
    );
  });

  it('filtra por status', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    await app.inject({ method: 'GET', url: '/actions?status=PARTIALLY_EXECUTED' });

    expect(prisma.action.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: WORKSPACE_ID, status: 'PARTIALLY_EXECUTED' } }),
    );
  });

  it('filtra por experimento', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    await app.inject({ method: 'GET', url: `/actions?experimentId=${EXPERIMENT_ID}` });

    expect(prisma.action.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: WORKSPACE_ID, experimentId: EXPERIMENT_ID } }),
    );
  });

  it('recusa um status que não existe', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({ method: 'GET', url: '/actions?status=PUBLISHED' });

    expect(res.statusCode).toBe(400);
  });

  it('VIEWER lê', async () => {
    const app = await buildApp(prismaFake(), { role: 'VIEWER' });

    const res = await app.inject({ method: 'GET', url: '/actions' });

    expect(res.statusCode).toBe(200);
  });
});

describe('GET /actions/:id', () => {
  it('devolve a ação, os alvos e o histórico de aprovação', async () => {
    const prisma = prismaFake({
      action: {
        ...ACTION,
        status: 'EXECUTED',
        targets: [
          target({ status: 'PUBLISHED', externalId: 'post_1', postUrl: 'https://li/1', publishedAt: new Date() }),
        ],
      },
    });
    prisma.approval.findMany.mockResolvedValue([
      {
        id: 'ap-1',
        requestedBy: 'u1',
        reviewedBy: 'u2',
        status: 'APPROVED',
        comment: null,
        requestedAt: new Date('2026-08-05T10:30:00.000Z'),
        reviewedAt: new Date('2026-08-05T10:40:00.000Z'),
      },
    ]);
    const app = await buildApp(prisma);

    const res = await app.inject({ method: 'GET', url: `/actions/${ACTION_ID}` });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.action.id).toBe(ACTION_ID);
    expect(body.approvals).toHaveLength(1);
    // A proveniência vive no alvo, com o id e a URL que o provider devolveu.
    expect(body.targets[0]).toMatchObject({ externalId: 'post_1', postUrl: 'https://li/1', status: 'PUBLISHED' });
  });

  // Nada é afirmado sobre publicação antes de haver id e URL da fonte.
  it('um alvo pendente não traz id nem URL', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({ method: 'GET', url: `/actions/${ACTION_ID}` });

    expect(res.json().targets[0]).toMatchObject({ status: 'PENDING', externalId: null, postUrl: null });
  });

  it('uma ação de outro workspace é indistinguível de inexistente', async () => {
    const app = await buildApp(prismaFake({ action: null }));

    const res = await app.inject({ method: 'GET', url: `/actions/${ACTION_ID}` });

    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /actions/:id', () => {
  it('edita o texto de uma ação em PROPOSED', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    const res = await app.inject({
      method: 'PATCH',
      url: `/actions/${ACTION_ID}`,
      payload: { name: 'Outro nome', payload: { content: 'Texto revisado.' } },
    });

    expect(res.statusCode).toBe(200);
    expect(prisma.action.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ACTION_ID } }));
  });

  /**
   * A porta dos fundos que a checagem sobre o **resultado** da edição fecha.
   *
   * Um PATCH pode mandar só `platforms`. Checar apenas o que chegou deixaria criar
   * um post de texto para o LinkedIn e depois acrescentar o YouTube num segundo
   * PATCH — sem vídeo, sem título, aprovado por um humano, e falhando sozinho no
   * worker.
   */
  it('recusa acrescentar uma rede que o payload gravado não satisfaz', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma, {
      social: clientFake({
        listAccounts: vi
          .fn()
          .mockResolvedValue([
            ...ACCOUNTS,
            { id: 'acc-yt', platform: 'YOUTUBE', username: 'acme', pictureUrl: null, connected: true },
          ]),
      }),
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/actions/${ACTION_ID}`,
      payload: { platforms: ['YOUTUBE'] },
    });

    expect(res.statusCode).toBe(400);
    expect(prisma.actionTarget.createMany).not.toHaveBeenCalled();
  });

  it('troca o conjunto de redes', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    const res = await app.inject({
      method: 'PATCH',
      url: `/actions/${ACTION_ID}`,
      payload: { platforms: ['X'] },
    });

    expect(res.statusCode).toBe(200);
    // LINKEDIN sai, X entra.
    expect(prisma.actionTarget.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['tgt-1'] } } });
    expect(prisma.actionTarget.createMany).toHaveBeenCalledWith({
      data: [{ workspaceId: WORKSPACE_ID, actionId: ACTION_ID, platform: 'X', socialAccountId: 'acc-x' }],
    });
  });

  // Um post no mundo é fato: sumir com a linha apagaria a proveniência.
  it('nunca apaga um alvo já publicado', async () => {
    const prisma = prismaFake();
    prisma.actionTarget.findMany.mockResolvedValue([
      target({ status: 'PUBLISHED', externalId: 'post_1' }),
      target({ id: 'tgt-2', platform: 'THREADS' }),
    ]);
    const app = await buildApp(prisma);

    // `X` está conectada; `LINKEDIN` (publicada) e `THREADS` saem do conjunto.
    await app.inject({ method: 'PATCH', url: `/actions/${ACTION_ID}`, payload: { platforms: ['X'] } });

    // Só o alvo não publicado é removido.
    expect(prisma.actionTarget.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['tgt-2'] } } });
  });

  it('valida as redes novas como na criação', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({
      method: 'PATCH',
      url: `/actions/${ACTION_ID}`,
      payload: { platforms: ['FACEBOOK'] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AUR-T0047');
  });

  /**
   * Editar depois de submetido mudaria o que o aprovador leu. Aprovação sobre
   * texto — ou sobre redes — que já não estão lá não é aprovação.
   */
  it('recusa editar depois de submetido, com código próprio', async () => {
    const app = await buildApp(prismaFake({ action: { ...ACTION, status: 'PENDING_APPROVAL' } }));

    const res = await app.inject({
      method: 'PATCH',
      url: `/actions/${ACTION_ID}`,
      payload: { name: 'Outro nome' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('AUR-T0050');
  });

  it('recusa editar depois de executado', async () => {
    const app = await buildApp(prismaFake({ action: { ...ACTION, status: 'EXECUTED' } }));

    const res = await app.inject({
      method: 'PATCH',
      url: `/actions/${ACTION_ID}`,
      payload: { name: 'Outro nome' },
    });

    expect(res.statusCode).toBe(409);
  });

  it('VIEWER não edita', async () => {
    const app = await buildApp(prismaFake(), { role: 'VIEWER' });

    const res = await app.inject({
      method: 'PATCH',
      url: `/actions/${ACTION_ID}`,
      payload: { name: 'Outro nome' },
    });

    expect(res.statusCode).toBe(403);
  });
});

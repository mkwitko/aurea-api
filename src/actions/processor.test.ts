import { beforeEach, describe, expect, it, vi } from 'vitest';
import { seal } from '../billing/crypto.js';
import { SocialProviderError } from '../integrations/social/index.js';
import { executeAction } from './processor.js';

const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_WORKSPACE_ID = '99999999-9999-9999-9999-999999999999';
const ACTION_ID = '33333333-3333-3333-3333-333333333333';
const EXTERNAL_ID = `ws-${WORKSPACE_ID}`;

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
  lastCheckedAt: new Date(),
  lastError: null,
  createdBy: 'u1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const target = (over: Record<string, unknown> = {}) => ({
  id: 'tgt-1',
  workspaceId: WORKSPACE_ID,
  actionId: ACTION_ID,
  platform: 'LINKEDIN',
  socialAccountId: 'acc-li',
  status: 'PUBLISHING',
  externalId: null,
  postUrl: null,
  lastError: null,
  failureKind: null,
  attempts: 1,
  publishedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

const action = (over: Record<string, unknown> = {}) => ({
  id: ACTION_ID,
  workspaceId: WORKSPACE_ID,
  experimentId: null,
  type: 'SOCIAL_POST',
  name: 'Post sobre custo operacional',
  description: null,
  payload: { content: 'Como cortamos 30% do custo operacional.' },
  status: 'EXECUTING',
  createdBy: 'u1',
  approvedAt: new Date(),
  executedAt: null,
  providerPostId: null,
  heartbeatAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  targets: [target()],
  ...over,
});

function prismaFake(over: { action?: unknown; integration?: unknown } = {}) {
  const current = 'action' in over ? over.action : action();
  const targets = (current as { targets?: unknown[] } | null)?.targets ?? [];
  return {
    action: {
      findFirst: vi.fn().mockResolvedValue(current),
      update: vi.fn().mockResolvedValue(current),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    actionTarget: {
      findMany: vi.fn().mockResolvedValue(targets),
      update: vi.fn().mockResolvedValue(target()),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn().mockResolvedValue(0),
    },
    externalReference: { create: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) },
    workspaceIntegration: {
      findFirst: vi.fn().mockResolvedValue('integration' in over ? over.integration : INTEGRATION),
    },
  };
}

const logger = { info: vi.fn(), error: vi.fn() };

function clientFake(over: Record<string, unknown> = {}) {
  return {
    connectUrl: vi.fn(),
    listAccounts: vi.fn(),
    publish: vi.fn().mockResolvedValue({ postId: 'post_1' }),
    results: vi.fn(),
    disconnect: vi.fn(),
    ...over,
  };
}

function deps(prisma: unknown, client: ReturnType<typeof clientFake>, enqueuePoll = vi.fn()) {
  return {
    prisma: prisma as never,
    logger,
    socialClient: () => client as never,
    enqueuePoll,
    now: () => new Date('2026-08-05T12:00:00.000Z'),
  };
}

const job = (over: Record<string, unknown> = {}) => ({ actionId: ACTION_ID, workspaceId: WORKSPACE_ID, ...over });

beforeEach(() => vi.clearAllMocks());

describe('executeAction', () => {
  it('publica com os ids de conta dos alvos, e o external_id do workspace', async () => {
    const client = clientFake();
    const enqueuePoll = vi.fn();

    await executeAction(deps(prismaFake(), client, enqueuePoll), job());

    expect(client.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        caption: 'Como cortamos 30% do custo operacional.',
        socialAccountIds: ['acc-li'],
        externalId: EXTERNAL_ID,
      }),
      expect.anything(),
    );
    expect(enqueuePoll).toHaveBeenCalledWith({ actionId: ACTION_ID, workspaceId: WORKSPACE_ID, poll: 0 });
  });

  /**
   * A imagem vem do payload **gravado**, que é o que o aprovador leu. Um post sem
   * imagem manda `undefined`, e não `[]`: o conector omite o campo, que é o que o
   * provider espera para texto puro.
   */
  it('publica as imagens do payload, e nada quando não há', async () => {
    const withMedia = clientFake();
    const media = ['https://cdn.test.aurea/media/ws/a.png'];

    await executeAction(
      deps(prismaFake({ action: action({ payload: { content: 'com foto', media } }) }), withMedia),
      job(),
    );

    expect(withMedia.publish).toHaveBeenCalledWith(expect.objectContaining({ mediaUrls: media }), expect.anything());

    const withoutMedia = clientFake();
    await executeAction(deps(prismaFake(), withoutMedia), job());

    expect(withoutMedia.publish).toHaveBeenCalledWith(
      expect.objectContaining({ mediaUrls: undefined }),
      expect.anything(),
    );
  });

  /**
   * A chave do provider é a mesma para todos os clientes, então a lista de contas
   * do workspace é a única fronteira. Um job com ids cruzados não pode publicar
   * nada (spec de migração §4).
   */
  it('não publica quando o workspace do job não é o da ação', async () => {
    const prisma = prismaFake();
    prisma.action.findFirst.mockResolvedValue(null);
    const client = clientFake();

    await executeAction(deps(prisma, client), job({ workspaceId: OTHER_WORKSPACE_ID }));

    expect(prisma.action.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ACTION_ID, workspaceId: OTHER_WORKSPACE_ID } }),
    );
    expect(client.publish).not.toHaveBeenCalled();
  });

  it('manda o external_id do workspace da ação, não um fixo', async () => {
    const other = { ...INTEGRATION, workspaceId: OTHER_WORKSPACE_ID, externalId: `ws-${OTHER_WORKSPACE_ID}` };
    const prisma = prismaFake({ action: action({ workspaceId: OTHER_WORKSPACE_ID }), integration: other });
    const client = clientFake();

    await executeAction(deps(prisma, client), job({ workspaceId: OTHER_WORKSPACE_ID }));

    expect(client.publish).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: `ws-${OTHER_WORKSPACE_ID}` }),
      expect.anything(),
    );
  });

  // Publicar de novo onde já saiu criaria post duplicado; publicar onde não se
  // sabe pode criar. Nenhum dos dois entra na chamada.
  it('envia só os alvos em voo e os publicáveis', async () => {
    const targets = [
      target({ id: 'a', socialAccountId: 'acc-pub', status: 'PUBLISHED', externalId: 'post_x' }),
      target({ id: 'b', socialAccountId: 'acc-fail', status: 'FAILED', lastError: 'rate limited' }),
      target({ id: 'c', socialAccountId: 'acc-unk', status: 'DELIVERY_UNKNOWN' }),
      target({ id: 'd', socialAccountId: 'acc-fly', status: 'PUBLISHING' }),
    ];
    const client = clientFake();

    await executeAction(deps(prismaFake({ action: action({ targets }) }), client), job());

    expect(client.publish).toHaveBeenCalledWith(
      expect.objectContaining({ socialAccountIds: ['acc-fail', 'acc-fly'] }),
      expect.anything(),
    );
  });

  it('grava o id do post antes de agendar a leitura', async () => {
    const prisma = prismaFake();
    const enqueuePoll = vi.fn();

    await executeAction(deps(prisma, clientFake(), enqueuePoll), job());

    expect(prisma.action.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { providerPostId: 'post_1' } }),
    );
    expect(enqueuePoll).toHaveBeenCalled();
  });

  /**
   * Não existe retry de provider: um `providerPostId` guardado serve para **ler** o
   * desfecho, e tentar outra vez é um post novo — permitido só porque a rota exige
   * alvo `PENDING`/`FAILED`, ou seja, alvo sobre o qual a leitura anterior disse que
   * não criou (spec de migração §2.5).
   */
  it('com id de post guardado, publica de novo em vez de pedir retry', async () => {
    const prisma = prismaFake({
      action: action({ providerPostId: 'post_antigo', targets: [target({ status: 'FAILED' })] }),
    });
    const client = clientFake();

    await executeAction(deps(prisma, client), job());

    expect(client.publish).toHaveBeenCalledWith(
      expect.objectContaining({ socialAccountIds: ['acc-li'] }),
      expect.anything(),
    );
    // O id novo substitui o antigo: é o do post que acabou de ser criado.
    expect(prisma.action.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { providerPostId: 'post_1' } }),
    );
  });

  it('não faz nada quando a ação já saiu de EXECUTING', async () => {
    const client = clientFake();

    await executeAction(deps(prismaFake({ action: action({ status: 'CANCELLED' }) }), client), job());

    expect(client.publish).not.toHaveBeenCalled();
  });

  // Nada saiu: `FAILED`, não `DELIVERY_UNKNOWN`. Mandar o fundador conferir uma
  // rede onde nada foi tentado é pior que dizer que falhou.
  it('marca FAILED quando não há integração social', async () => {
    const prisma = prismaFake({ integration: null });

    await executeAction(deps(prisma, clientFake()), job());

    expect(prisma.actionTarget.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', failureKind: 'AUTH' }) }),
    );
  });

  // Sem chave na instância, nada é tentado — e o desfecho é `FAILED`, não
  // indeterminado: não existe post para conferir.
  it('marca FAILED quando montar o cliente falha, sem tocar na rede', async () => {
    const prisma = prismaFake();
    const client = clientFake();
    const failing = {
      ...deps(prisma, client),
      socialClient: () => {
        throw new SocialProviderError('AUTH', 'this instance has no social api key');
      },
    };

    await executeAction(failing, job());

    expect(client.publish).not.toHaveBeenCalled();
    expect(prisma.actionTarget.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', failureKind: 'AUTH' }) }),
    );
  });

  it('marca FAILED quando o payload gravado não é o contrato', async () => {
    const prisma = prismaFake({ action: action({ payload: { channelId: 'chan-1' } }) });
    const client = clientFake();

    await executeAction(deps(prisma, client), job());

    expect(client.publish).not.toHaveBeenCalled();
    expect(prisma.actionTarget.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', failureKind: 'VALIDATION' }) }),
    );
  });

  /**
   * Um alvo sem conta é a guarda de um estado que não deveria existir: a criação
   * resolve a conta de cada rede antes de gravar o alvo. `FAILED` e não
   * indeterminado — nada foi enviado por ele.
   */
  it('marca FAILED o alvo sem conta, e publica os outros', async () => {
    const targets = [
      target({ id: 'orfao', socialAccountId: null }),
      target({ id: 'ok', socialAccountId: 'acc-ok' }),
    ];
    const prisma = prismaFake({ action: action({ targets }) });
    const client = clientFake();

    await executeAction(deps(prisma, client), job());

    expect(prisma.actionTarget.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['orfao'] } },
        data: expect.objectContaining({ status: 'FAILED', failureKind: 'VALIDATION' }),
      }),
    );
    expect(client.publish).toHaveBeenCalledWith(
      expect.objectContaining({ socialAccountIds: ['acc-ok'] }),
      expect.anything(),
    );
  });

  it('não publica quando nenhum alvo tem conta', async () => {
    const prisma = prismaFake({ action: action({ targets: [target({ socialAccountId: null })] }) });
    const client = clientFake();

    await executeAction(deps(prisma, client), job());

    expect(client.publish).not.toHaveBeenCalled();
  });

  // O provider respondeu, então não criou nada: relançar é o que faz o BullMQ
  // tentar de novo, e é seguro.
  it('relança em RATE_LIMIT, mantendo os alvos em voo', async () => {
    const prisma = prismaFake();
    const client = clientFake({
      publish: vi.fn().mockRejectedValue(new SocialProviderError('RATE_LIMIT', 'slow down', 429)),
    });

    await expect(executeAction(deps(prisma, client), job())).rejects.toBeInstanceOf(SocialProviderError);

    expect(prisma.actionTarget.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lastError: 'slow down', failureKind: 'RATE_LIMIT' } }),
    );
  });

  // Não se sabe se o post existe, e um segundo envio duplicaria. Não relança.
  it('marca DELIVERY_UNKNOWN em falha de rede, e não relança', async () => {
    const prisma = prismaFake();
    const client = clientFake({
      publish: vi.fn().mockRejectedValue(new SocialProviderError('NETWORK', 'socket hang up')),
    });

    await expect(executeAction(deps(prisma, client), job())).resolves.toBeUndefined();

    expect(prisma.actionTarget.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DELIVERY_UNKNOWN', failureKind: 'NETWORK' }),
      }),
    );
    // Sem id de post: não há o que consultar depois, e é por isso que a saída
    // deste caso é humana.
    expect(prisma.action.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ providerPostId: expect.anything() }) }),
    );
  });

  it('marca FAILED em erro de validação, e não relança', async () => {
    const prisma = prismaFake();
    const client = clientFake({
      publish: vi.fn().mockRejectedValue(new SocialProviderError('VALIDATION', 'caption is too long', 400)),
    });

    await expect(executeAction(deps(prisma, client), job())).resolves.toBeUndefined();

    expect(prisma.actionTarget.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', lastError: 'caption is too long' }),
      }),
    );
  });
});

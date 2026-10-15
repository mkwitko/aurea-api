import { beforeEach, describe, expect, it, vi } from 'vitest';
import { seal } from '../billing/crypto.js';
import { SocialProviderError } from '../integrations/social/index.js';
import { pollAction } from './poll.js';

const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';
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
  name: 'Post',
  description: null,
  payload: { content: 'texto' },
  status: 'EXECUTING',
  createdBy: 'u1',
  approvedAt: new Date(),
  executedAt: null,
  providerPostId: 'post_1',
  heartbeatAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  targets: [target()],
  ...over,
});

/**
 * `stillFlying` é o que a busca por `status: 'PUBLISHING'` devolve **depois** das
 * escritas — é assim que o poll decide se a publicação terminou, porque o provider
 * não tem status agregado a ler (spec de migração §2.4).
 */
function prismaFake(over: { action?: unknown; integration?: unknown; stillFlying?: unknown[] } = {}) {
  const current = 'action' in over ? over.action : action();
  const targets = (current as { targets?: unknown[] } | null)?.targets ?? [];
  const flying = over.stillFlying ?? [];
  const actionTarget = {
    findMany: vi.fn().mockImplementation(({ where }: { where?: { status?: string } }) => {
      if (where?.status === 'PUBLISHING') return Promise.resolve(flying);
      return Promise.resolve(targets);
    }),
    update: vi.fn().mockResolvedValue(target()),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    count: vi.fn().mockResolvedValue(0),
  };
  return {
    action: {
      findFirst: vi.fn().mockResolvedValue(current),
      update: vi.fn().mockResolvedValue(current),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    actionTarget,
    externalReference: { create: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) },
    workspaceIntegration: {
      findFirst: vi.fn().mockResolvedValue('integration' in over ? over.integration : INTEGRATION),
    },
  };
}

const logger = { info: vi.fn(), error: vi.fn() };

const clientFake = (results: unknown) => ({
  connectUrl: vi.fn(),
  listAccounts: vi.fn(),
  publish: vi.fn(),
  results,
  disconnect: vi.fn(),
});

const outcome = (over: Record<string, unknown> = {}) => ({
  socialAccountId: 'acc-li',
  success: true,
  message: null,
  externalId: 'urn:li:share:1',
  postUrl: 'https://li/1',
  ...over,
});

const returning = (rows: unknown[]) => vi.fn().mockResolvedValue(rows);

function deps(prisma: unknown, client: unknown, enqueuePoll = vi.fn()) {
  return {
    prisma: prisma as never,
    logger,
    socialClient: () => client as never,
    enqueuePoll,
    now: () => new Date('2026-08-05T12:00:00.000Z'),
  };
}

const job = (poll = 0) => ({ actionId: ACTION_ID, workspaceId: WORKSPACE_ID, poll });

beforeEach(() => vi.clearAllMocks());

describe('pollAction', () => {
  /**
   * A leitura é a única fonte de "publicado": vem autenticada, com o id e a URL do
   * post real em `platform_data`. A resposta do POST nunca vira `PUBLISHED` — um id
   * de post não é um post publicado (spec §8.2).
   */
  it('grava PUBLISHED com o id e a URL da fonte', async () => {
    const prisma = prismaFake();
    const client = clientFake(returning([outcome()]));

    await pollAction(deps(prisma, client), job());

    expect(prisma.actionTarget.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tgt-1' },
        data: expect.objectContaining({
          status: 'PUBLISHED',
          externalId: 'urn:li:share:1',
          postUrl: 'https://li/1',
        }),
      }),
    );
  });

  it('lê o desfecho pelo id do post da ação', async () => {
    const prisma = prismaFake();
    const results = returning([outcome()]);

    await pollAction(deps(prisma, clientFake(results)), job());

    expect(results).toHaveBeenCalledWith('post_1', expect.anything());
    expect(prisma.action.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ACTION_ID, workspaceId: WORKSPACE_ID } }),
    );
  });

  it('grava a proveniência do alvo publicado', async () => {
    const prisma = prismaFake();
    const client = clientFake(returning([outcome()]));

    await pollAction(deps(prisma, client), job());

    expect(prisma.externalReference.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        integrationId: 'int-social',
        entityType: 'SOCIAL_POST_TARGET',
        entityId: 'tgt-1',
        externalId: 'urn:li:share:1',
      }),
    });
  });

  // A trava no banco existe justamente para isso: um post por rede por ação. A
  // corrida entre duas leituras não pode virar erro.
  it('trata violação de unique como sucesso', async () => {
    const prisma = prismaFake();
    prisma.externalReference.create.mockRejectedValue({ code: 'P2002' });
    const client = clientFake(returning([outcome({ postUrl: null })]));

    await expect(pollAction(deps(prisma, client), job())).resolves.toBeUndefined();

    expect(prisma.actionTarget.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PUBLISHED' }) }),
    );
  });

  it('não grava proveniência sem id do provider', async () => {
    const prisma = prismaFake();
    const client = clientFake(returning([outcome({ externalId: null, postUrl: null })]));

    await pollAction(deps(prisma, client), job());

    expect(prisma.externalReference.create).not.toHaveBeenCalled();
  });

  /**
   * Falha por conta é sempre `FAILED`, qualquer que seja a mensagem: o provider
   * tentou, sabe o que aconteceu, e está nos dizendo. Não é indeterminação
   * (spec §8.4).
   */
  it('grava FAILED com a mensagem literal da fonte', async () => {
    const prisma = prismaFake();
    const client = clientFake(
      returning([outcome({ success: false, message: 'Duplicate content', externalId: null, postUrl: null })]),
    );

    await pollAction(deps(prisma, client), job());

    expect(prisma.actionTarget.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', lastError: 'Duplicate content' }),
      }),
    );
  });

  /**
   * Casado por **conta**, não por rede: duas contas podem viver na mesma rede, e
   * casar por plataforma escreveria o desfecho de uma na outra.
   */
  it('casa o desfecho pela conta, não pela rede', async () => {
    const prisma = prismaFake({
      action: action({
        targets: [
          target({ id: 'tgt-a', socialAccountId: 'acc-1' }),
          target({ id: 'tgt-b', socialAccountId: 'acc-2' }),
        ],
      }),
    });
    const client = clientFake(returning([outcome({ socialAccountId: 'acc-2', externalId: 'post_2' })]));

    await pollAction(deps(prisma, client), job());

    expect(prisma.actionTarget.update).toHaveBeenCalledTimes(1);
    expect(prisma.actionTarget.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'tgt-b' } }));
  });

  // Conta que não é alvo desta ação: escrever por causa dela inventaria desfecho.
  it('ignora desfecho de conta que não é alvo', async () => {
    const prisma = prismaFake();
    const client = clientFake(returning([outcome({ socialAccountId: 'acc-de-outra-acao' })]));

    await pollAction(deps(prisma, client), job());

    expect(prisma.actionTarget.update).not.toHaveBeenCalled();
  });

  /**
   * O provider não tem status agregado: `results` traz uma linha por conta já
   * processada. Faltar linha é "ainda não terminou", nunca "falhou" — o contrário
   * seria assumir conclusão por ausência (spec de migração §2.4).
   */
  it('reagenda enquanto algum alvo continua em voo', async () => {
    const prisma = prismaFake({ stillFlying: [target()] });
    const client = clientFake(returning([]));
    const enqueuePoll = vi.fn();

    await pollAction(deps(prisma, client, enqueuePoll), job(3));

    expect(enqueuePoll).toHaveBeenCalledWith({ actionId: ACTION_ID, workspaceId: WORKSPACE_ID, poll: 4 });
  });

  it('fecha quando nenhum alvo está mais em voo', async () => {
    const prisma = prismaFake({ stillFlying: [] });
    prisma.actionTarget.count.mockResolvedValue(1);
    const client = clientFake(returning([outcome()]));
    const enqueuePoll = vi.fn();

    await pollAction(deps(prisma, client, enqueuePoll), job());

    expect(enqueuePoll).not.toHaveBeenCalled();
    expect(prisma.action.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ heartbeatAt: null }) }),
    );
  });

  /**
   * Ler é seguro: `GET` não cria nada. Uma leitura que falhou não diz nada sobre o
   * post, então nada é escrito no alvo — só a próxima leitura é agendada. É o que
   * separa este caminho do de publicação, onde retentar pode duplicar.
   */
  it('uma leitura que falha não escreve desfecho, só reagenda', async () => {
    const prisma = prismaFake({ stillFlying: [target()] });
    const client = clientFake(vi.fn().mockRejectedValue(new SocialProviderError('PROVIDER', 'boom', 500)));
    const enqueuePoll = vi.fn();

    await expect(pollAction(deps(prisma, client, enqueuePoll), job(1))).resolves.toBeUndefined();

    expect(prisma.actionTarget.update).not.toHaveBeenCalled();
    expect(enqueuePoll).toHaveBeenCalledWith({ actionId: ACTION_ID, workspaceId: WORKSPACE_ID, poll: 2 });
  });

  /**
   * Leituras esgotadas com alvo em voo: não sabemos se publicou. `FAILED` negaria
   * um post que pode existir, e não há retry de provider a tentar — a saída é
   * humana (spec de migração §2.5).
   */
  it('marca DELIVERY_UNKNOWN quando as leituras esgotam com alvo em voo', async () => {
    const prisma = prismaFake({ stillFlying: [target()] });
    const client = clientFake(returning([]));
    const enqueuePoll = vi.fn();

    // 19 é a última leitura com `ACTION_POLL_MAX_ATTEMPTS` no default de 20.
    await pollAction(deps(prisma, client, enqueuePoll), job(19));

    expect(enqueuePoll).not.toHaveBeenCalled();
    expect(prisma.actionTarget.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['tgt-1'] } },
        data: expect.objectContaining({ status: 'DELIVERY_UNKNOWN' }),
      }),
    );
  });

  // `publishedAt` é o momento em que soubemos; reescrevê-lo a cada leitura moveria
  // a data para sempre.
  it('não reescreve um alvo já publicado', async () => {
    const prisma = prismaFake({
      action: action({ targets: [target({ status: 'PUBLISHED', externalId: 'post_1' })] }),
    });
    const client = clientFake(returning([outcome()]));

    await pollAction(deps(prisma, client), job());

    expect(prisma.actionTarget.update).not.toHaveBeenCalled();
  });

  it('não lê nada quando a ação saiu de EXECUTING', async () => {
    const prisma = prismaFake({ action: action({ status: 'DELIVERY_UNKNOWN' }) });
    const results = vi.fn();

    await pollAction(deps(prisma, clientFake(results)), job());

    expect(results).not.toHaveBeenCalled();
  });

  it('não lê nada sem id do post', async () => {
    const prisma = prismaFake({ action: action({ providerPostId: null }) });
    const results = vi.fn();

    await pollAction(deps(prisma, clientFake(results)), job());

    expect(results).not.toHaveBeenCalled();
  });

  it('carimba executedAt na primeira publicação confirmada', async () => {
    const prisma = prismaFake();
    prisma.actionTarget.count.mockResolvedValue(1);
    const client = clientFake(returning([outcome()]));

    await pollAction(deps(prisma, client), job());

    expect(prisma.action.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ executedAt: new Date('2026-08-05T12:00:00.000Z') }) }),
    );
  });

  it('não reescreve executedAt de uma ação que já publicou antes', async () => {
    const prisma = prismaFake({ action: action({ executedAt: new Date('2026-08-04T00:00:00.000Z') }) });
    prisma.actionTarget.count.mockResolvedValue(1);
    const client = clientFake(returning([outcome()]));

    await pollAction(deps(prisma, client), job());

    const calls = prisma.action.update.mock.calls as Array<[{ data: Record<string, unknown> }]>;
    expect(calls.every(([arg]) => !('executedAt' in arg.data))).toBe(true);
  });
});

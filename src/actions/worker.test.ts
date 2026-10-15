import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createActionProcessor, reconcileExhaustedAction } from './worker.js';

const ACTION_ID = 'act-1';
const WORKSPACE_ID = 'ws-1';

const logger = { info: vi.fn(), error: vi.fn() };

const flying = (over: Record<string, unknown> = {}) => ({
  id: 'tgt-1',
  lastError: 'slow down',
  failureKind: 'RATE_LIMIT',
  ...over,
});

/** `'action' in over`: os casos negativos passam `null` de propósito. */
function prismaFake(over: { action?: unknown; targets?: unknown[] } = {}) {
  const targets = over.targets ?? [flying()];
  return {
    action: {
      findUnique: vi.fn().mockResolvedValue('action' in over ? over.action : { status: 'EXECUTING' }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    actionTarget: {
      findMany: vi.fn().mockImplementation(({ where }: { where?: { status?: string } }) =>
        Promise.resolve(where?.status === 'PUBLISHING' ? targets : [{ status: 'FAILED' }]),
      ),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

const deps = (prisma: ReturnType<typeof prismaFake>) => ({ prisma: prisma as never, logger });

const job = (over: Record<string, unknown> = {}) => ({
  name: 'execute',
  data: { actionId: ACTION_ID, workspaceId: WORKSPACE_ID },
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('createActionProcessor', () => {
  it('relança o que o processor relançou, para o BullMQ retentar', async () => {
    const boom = new Error('slow down');
    const processor = createActionProcessor(deps(prismaFake()), { execute: vi.fn().mockRejectedValue(boom) });

    await expect(processor(job())).rejects.toBe(boom);
  });

  it('não relança quando o processor concluiu', async () => {
    const processor = createActionProcessor(deps(prismaFake()), { execute: vi.fn().mockResolvedValue(undefined) });

    await expect(processor(job())).resolves.toBeUndefined();
  });

  /**
   * Os dois tipos de job vivem na mesma fila, e o que fazem com uma falha é
   * oposto: publicar não pode retentar sem saber se criou, ler pode sempre. Trocar
   * um pelo outro publicaria onde devia apenas consultar.
   */
  it('despacha poll para o leitor, e execute para o publicador', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const poll = vi.fn().mockResolvedValue(undefined);
    const processor = createActionProcessor(deps(prismaFake()), { execute, poll });

    await processor(job({ name: 'poll', data: { actionId: ACTION_ID, workspaceId: WORKSPACE_ID, poll: 2 } }));
    expect(poll).toHaveBeenCalledWith(expect.anything(), { actionId: ACTION_ID, workspaceId: WORKSPACE_ID, poll: 2 });
    expect(execute).not.toHaveBeenCalled();

    await processor(job());
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe('reconcileExhaustedAction', () => {
  /**
   * `RATE_LIMIT` e `PROVIDER` são as únicas falhas que o processor relança, e as
   * duas significam que o provider respondeu e não criou nada — em toda tentativa.
   * `FAILED` é o desfecho honesto, e é o que permite retentar sem mandar o
   * fundador conferir uma rede onde nada foi publicado.
   */
  it('esgotar tentativas de RATE_LIMIT vira FAILED no alvo', async () => {
    const prisma = prismaFake();

    await reconcileExhaustedAction(deps(prisma), ACTION_ID);

    expect(prisma.actionTarget.updateMany).toHaveBeenCalledWith({
      where: { id: 'tgt-1', status: 'PUBLISHING' },
      data: expect.objectContaining({ status: 'FAILED', lastError: 'slow down' }),
    });
  });

  it('esgotar tentativas de PROVIDER vira FAILED', async () => {
    const prisma = prismaFake({ targets: [flying({ failureKind: 'PROVIDER', lastError: 'bad gateway' })] });

    await reconcileExhaustedAction(deps(prisma), ACTION_ID);

    expect(prisma.actionTarget.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
  });

  // Sem motivo gravado, não há garantia de que o pedido não saiu: vale a regra
  // conservadora, porque republicar às cegas duplica post público.
  it('sem motivo gravado vira DELIVERY_UNKNOWN', async () => {
    const prisma = prismaFake({ targets: [flying({ failureKind: null, lastError: null })] });

    await reconcileExhaustedAction(deps(prisma), ACTION_ID);

    expect(prisma.actionTarget.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'DELIVERY_UNKNOWN',
          lastError: 'the execution job ran out of attempts',
        }),
      }),
    );
  });

  it('um motivo de rede vira DELIVERY_UNKNOWN, preservando a mensagem', async () => {
    const prisma = prismaFake({ targets: [flying({ failureKind: 'NETWORK', lastError: 'fetch failed' })] });

    await reconcileExhaustedAction(deps(prisma), ACTION_ID);

    expect(prisma.actionTarget.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DELIVERY_UNKNOWN', lastError: 'fetch failed' }),
      }),
    );
  });

  // Cada alvo decide pelo que se sabe dele: um pode ter tomado 429 e o outro ter
  // morrido sem resposta, e um desfecho só para os dois mentiria para um.
  it('decide por alvo, não pela ação', async () => {
    const prisma = prismaFake({
      targets: [
        flying({ id: 'a', failureKind: 'RATE_LIMIT', lastError: 'slow down' }),
        flying({ id: 'b', failureKind: 'NETWORK', lastError: 'fetch failed' }),
      ],
    });

    await reconcileExhaustedAction(deps(prisma), ACTION_ID);

    expect(prisma.actionTarget.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { id: 'a', status: 'PUBLISHING' }, data: expect.objectContaining({ status: 'FAILED' }) }),
    );
    expect(prisma.actionTarget.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'b', status: 'PUBLISHING' },
        data: expect.objectContaining({ status: 'DELIVERY_UNKNOWN' }),
      }),
    );
  });

  it('recalcula o status da ação pela agregação', async () => {
    const prisma = prismaFake();

    await reconcileExhaustedAction(deps(prisma), ACTION_ID);

    expect(prisma.action.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', heartbeatAt: null }) }),
    );
  });

  // O desfecho que o poll ou um humano já gravou é o que vale.
  it('não toca numa ação que já saiu de EXECUTING', async () => {
    const prisma = prismaFake({ action: { status: 'EXECUTED' } });

    await reconcileExhaustedAction(deps(prisma), ACTION_ID);

    expect(prisma.actionTarget.updateMany).not.toHaveBeenCalled();
  });

  it('não estoura quando a ação já não existe', async () => {
    const prisma = prismaFake({ action: null });

    await expect(reconcileExhaustedAction(deps(prisma), ACTION_ID)).resolves.toBeUndefined();
    expect(prisma.actionTarget.updateMany).not.toHaveBeenCalled();
  });
});

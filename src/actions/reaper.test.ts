import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reapStuckActions } from './reaper.js';

const NOW = new Date('2026-08-05T12:00:00.000Z');
const OLD = new Date('2026-08-05T11:00:00.000Z');

const STUCK = { id: 'act-1', workspaceId: 'ws-1' };

const flying = (over: Record<string, unknown> = {}) => ({ id: 'tgt-1', lastError: null, ...over });

function prismaFake(rows: unknown[] = [STUCK], targets: unknown[] = [flying()]) {
  return {
    action: {
      findMany: vi.fn().mockResolvedValue(rows),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    actionTarget: {
      findMany: vi.fn().mockImplementation(({ where }: { where?: { status?: string } }) =>
        // A busca por `PUBLISHING` devolve os alvos em voo; a da agregação, com
        // `select: { status }`, devolve o estado resultante.
        Promise.resolve(where?.status === 'PUBLISHING' ? targets : [{ status: 'DELIVERY_UNKNOWN' }]),
      ),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

const logger = { info: vi.fn(), error: vi.fn() };

beforeEach(() => vi.clearAllMocks());

describe('reapStuckActions', () => {
  /**
   * O processo do worker morre no meio — deploy, OOM, `tsx watch` recarregando.
   * A ação fica EXECUTING para sempre, e o post pode ter saído. É a mesma razão
   * do reaper de agent runs, com o desfecho diferente: aqui não é FAILED.
   */
  it('move os alvos em voo para DELIVERY_UNKNOWN', async () => {
    const prisma = prismaFake();

    const reaped = await reapStuckActions({ prisma: prisma as never, logger }, { now: NOW, staleMs: 120_000 });

    expect(reaped).toBe(1);
    expect(prisma.actionTarget.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // O `status: 'PUBLISHING'` no where é o que impede sobrescrever um
        // desfecho que o poll gravou entre a busca e a escrita.
        where: { id: 'tgt-1', status: 'PUBLISHING' },
        data: expect.objectContaining({ status: 'DELIVERY_UNKNOWN' }),
      }),
    );
  });

  it('nunca marca FAILED — o processo morto pode ter publicado', async () => {
    const prisma = prismaFake();

    await reapStuckActions({ prisma: prisma as never, logger }, { now: NOW });

    const written = prisma.actionTarget.updateMany.mock.calls[0]![0] as { data: { status: string } };
    expect(written.data.status).not.toBe('FAILED');
  });

  /**
   * O status da Action vem da agregação, e nunca de uma escrita à mão do reaper:
   * um alvo já publicado com a Action dizendo "entrega incerta" mandaria o
   * fundador conferir o que já está no ar.
   */
  it('recalcula o status da ação pela agregação dos alvos', async () => {
    const prisma = prismaFake();

    await reapStuckActions({ prisma: prisma as never, logger }, { now: NOW });

    expect(prisma.action.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'act-1' },
        data: expect.objectContaining({ status: 'DELIVERY_UNKNOWN', heartbeatAt: null }),
      }),
    );
  });

  it('busca só EXECUTING sem heartbeat recente', async () => {
    const prisma = prismaFake();

    await reapStuckActions({ prisma: prisma as never, logger }, { now: NOW, staleMs: 120_000 });

    const cutoff = new Date(NOW.getTime() - 120_000);
    expect(prisma.action.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'EXECUTING',
          // Heartbeat nulo com updatedAt velho conta: é a execução que morreu
          // antes de carimbar o primeiro sinal.
          OR: [{ heartbeatAt: { lt: cutoff } }, { heartbeatAt: null, updatedAt: { lt: cutoff } }],
        },
      }),
    );
  });

  // Se a tentativa já gravou a mensagem do provider, ela é a única pista que
  // existe: o texto do reaper a apagaria.
  it('preserva o lastError que a tentativa já tinha gravado', async () => {
    const prisma = prismaFake([STUCK], [flying({ lastError: 'bad gateway' })]);

    await reapStuckActions({ prisma: prisma as never, logger }, { now: NOW });

    expect(prisma.actionTarget.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastError: 'bad gateway' }) }),
    );
  });

  it('escreve o próprio texto quando não havia motivo nenhum', async () => {
    const prisma = prismaFake([STUCK], [flying({ lastError: null })]);

    await reapStuckActions({ prisma: prisma as never, logger }, { now: NOW, staleMs: 120_000 });

    expect(prisma.actionTarget.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastError: expect.stringContaining('no sign of life for 120s') }),
      }),
    );
  });

  // Um alvo que o poll fechou entre a busca e a escrita não é tocado: só quem
  // está em voo interessa ao reaper.
  it('não escreve alvo nenhum quando nada ficou em voo', async () => {
    const prisma = prismaFake([STUCK], []);

    await reapStuckActions({ prisma: prisma as never, logger }, { now: NOW });

    expect(prisma.actionTarget.updateMany).not.toHaveBeenCalled();
    // A agregação ainda roda: é ela que tira a Action de EXECUTING.
    expect(prisma.action.update).toHaveBeenCalled();
  });

  it('não escreve nada quando não há execução travada', async () => {
    const prisma = prismaFake([]);

    const reaped = await reapStuckActions({ prisma: prisma as never, logger }, { now: NOW });

    expect(reaped).toBe(0);
    expect(prisma.actionTarget.updateMany).not.toHaveBeenCalled();
    expect(prisma.action.update).not.toHaveBeenCalled();
  });
});

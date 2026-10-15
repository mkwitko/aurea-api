import type { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { writeAggregatedStatus } from './aggregate.js';

export type ActionReaperDeps = {
  prisma: PrismaClient;
  logger: { info: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
};

/**
 * Fecha as execuções que pararam de dar sinal de vida.
 *
 * O processo do worker pode morrer no meio de uma publicação — deploy, OOM, o
 * `tsx watch` recarregando em desenvolvimento. A ação fica `EXECUTING` para
 * sempre, e o post pode ter saído.
 *
 * O desfecho do alvo é `DELIVERY_UNKNOWN`, **nunca** `FAILED`: um processo morto
 * pode ter publicado, e `FAILED` convida a republicar (spec §8.5).
 */
export async function reapStuckActions(
  deps: ActionReaperDeps,
  options: { staleMs?: number; limit?: number; now?: Date } = {},
): Promise<number> {
  const staleMs = options.staleMs ?? env.ACTION_STALE_MS;
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - staleMs);

  const stuck = await deps.prisma.action.findMany({
    where: {
      status: 'EXECUTING',
      // Heartbeat nulo com `updatedAt` velho conta: é a execução que morreu
      // antes de carimbar o primeiro sinal.
      OR: [{ heartbeatAt: { lt: cutoff } }, { heartbeatAt: null, updatedAt: { lt: cutoff } }],
    },
    select: { id: true, workspaceId: true },
    take: options.limit ?? 100,
    orderBy: { updatedAt: 'asc' },
  });

  const fallback = `no sign of life for ${Math.round(staleMs / 1000)}s — check the network before trying again`;

  for (const action of stuck) {
    // Os alvos que ficaram em voo. `status: 'PUBLISHING'` no where: se o poll
    // gravou um desfecho entre a busca e esta escrita, o dele vale.
    const flying = await deps.prisma.actionTarget.findMany({
      where: { actionId: action.id, status: 'PUBLISHING' },
      select: { id: true, lastError: true },
    });

    for (const target of flying) {
      await deps.prisma.actionTarget.updateMany({
        where: { id: target.id, status: 'PUBLISHING' },
        data: {
          status: 'DELIVERY_UNKNOWN',
          failureKind: 'UNKNOWN',
          // A mensagem que a tentativa já tinha gravado é preservada: se o
          // provider disse algo antes de o processo morrer, essa é a única pista
          // que existe, e o texto do reaper a apagaria.
          lastError: target.lastError ?? fallback,
        },
      });
    }

    // O status da Action vem da agregação, sempre: escrevê-lo aqui à mão poria a
    // Action em desacordo com os alvos — e um alvo publicado com a Action dizendo
    // "entrega incerta" mandaria o fundador conferir o que já está no ar.
    await writeAggregatedStatus(deps.prisma, action.id, { heartbeatAt: null });
  }

  return stuck.length;
}

/**
 * Roda no boot e em intervalo fixo. `unref` para não segurar o processo aberto
 * no desligamento — mesma forma de `startStaleRunReaper`.
 */
export function startActionReaper(deps: ActionReaperDeps): NodeJS.Timeout {
  const tick = async (): Promise<void> => {
    try {
      const reaped = await reapStuckActions(deps);
      if (reaped > 0) deps.logger.info({ reaped }, 'reaped action executions without a heartbeat');
    } catch (error) {
      deps.logger.error({ err: error }, 'the action reaper failed');
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), env.ACTION_REAPER_INTERVAL_MS);
  timer.unref();
  return timer;
}

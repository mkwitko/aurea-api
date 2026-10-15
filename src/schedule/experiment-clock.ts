import { ExperimentStatus } from '@prisma/client';
import { env } from '../config/env.js';
import { dueTransition } from '../http/api/experiments/experiments.clock.js';
import type { ExperimentsRepository } from '../http/api/experiments/experiments.repository.js';
import { transitionExperimentService } from '../http/api/experiments/experiments.transition.js';

/** O mesmo contrato de log que o worker de runs usa: `info`/`error` sobre um objeto. */
export type ClockLogger = { info(obj: object, msg: string): void; error(obj: object, msg: string): void };

export type ExperimentClockDeps = { repo: ExperimentsRepository; logger: ClockLogger };

/**
 * Cumpre as datas que venceram, uma passada.
 *
 * Escreve pelo `transitionExperimentService` — o mesmo serviço dos botões — e
 * portanto passa por `assertExperimentTransition`. O relógio não pode fazer um
 * movimento que um humano não poderia, e não é um segundo caminho de escrita
 * livre para divergir da tabela de transições.
 *
 * Devolve quantos moveu, para o log só falar quando houve o que dizer.
 */
export async function tickExperimentClock(
  deps: ExperimentClockDeps,
  options: { now?: Date } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const due = await deps.repo.findDueSystemWide(now);
  const transition = transitionExperimentService({ repo: deps.repo });

  let moved = 0;

  for (const row of due) {
    const to = dueTransition(row, now);
    if (!to) continue;

    try {
      await transition({
        workspaceId: row.workspaceId,
        id: row.id,
        to,
        // `endDate` não é escrita aqui, ao contrário de complete-experiment,
        // que faz backfill quando o fundador completa à mão sem data: o
        // relógio só completa quem já tem `endDate`, então não há o que
        // preencher — e preencher seria inventar a data.
        extra: () => (to === ExperimentStatus.COMPLETED ? { completedAt: now } : {}),
      });
      moved++;
    } catch (error) {
      // Uma linha que falha não derruba a passada: o experimento pode ter sido
      // cancelado entre a leitura e a escrita, e o próximo tick reavalia.
      deps.logger.error(
        { experimentId: row.id, workspaceId: row.workspaceId, to, err: error },
        'the experiment clock could not move an experiment',
      );
    }
  }

  return moved;
}

/**
 * Roda o relógio no boot e em intervalo fixo. `unref` para não segurar o
 * processo aberto no desligamento — mesmo padrão de `startStaleRunReaper`.
 *
 * Idempotente por construção: a consulta é por status e data, não por evento.
 * Worker fora do ar significa transição atrasada, nunca perdida.
 */
export function startExperimentClock(deps: ExperimentClockDeps): NodeJS.Timeout {
  const tick = async (): Promise<void> => {
    try {
      const moved = await tickExperimentClock(deps);
      if (moved > 0) deps.logger.info({ moved }, 'the experiment clock moved experiments whose dates came due');
    } catch (error) {
      deps.logger.error({ err: error }, 'the experiment clock failed');
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), env.EXPERIMENT_CLOCK_INTERVAL_MS);
  timer.unref();
  return timer;
}

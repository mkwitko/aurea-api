import { ExperimentStatus } from '@prisma/client';

/** O que a decisão precisa saber de um experimento, e nada mais. */
export type ClockRow = {
  id: string;
  workspaceId: string;
  status: ExperimentStatus;
  startDate: Date | null;
  endDate: Date | null;
};

/**
 * A fronteira do dia: um `endDate` **antes** disto teve o dia inteiro cumprido.
 *
 * `Workspace` não tem timezone, então a fronteira é uma escolha e não um dado.
 * UTC, e errando para o lado de não fechar cedo: um experimento com `endDate`
 * hoje não completa hoje. Quando o timezone por workspace existir, esta função é
 * o único lugar que muda.
 *
 * Exportada porque a consulta do relógio filtra por ela: um `where` mais largo
 * que esta regra traz linha que `dueTransition` descarta, e linha descartada não
 * é escrita — então seu `updatedAt` não muda, e ela volta na mesma página do
 * tick seguinte, para sempre, ocupando um dos slots do `take`. É a mesma
 * fronteira nos dois lugares, ou é fome.
 */
export function clockCutoff(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Para onde este experimento vai agora, ou null se fica onde está.
 *
 * Pura de propósito: `now` entra por parâmetro para o teste poder afirmar a
 * fronteira do dia sem mexer no relógio do processo.
 *
 * O relógio **cumpre** datas declaradas pelo humano; nunca as escreve. Sem
 * `startDate` não há início, e sem `endDate` não há fim — a ausência da data é
 * a ausência da declaração.
 */
export function dueTransition(row: ClockRow, now: Date): ExperimentStatus | null {
  if (row.status === ExperimentStatus.APPROVED) {
    return row.startDate && row.startDate.getTime() <= now.getTime() ? ExperimentStatus.RUNNING : null;
  }

  if (row.status === ExperimentStatus.RUNNING) {
    return row.endDate && row.endDate.getTime() < clockCutoff(now).getTime() ? ExperimentStatus.COMPLETED : null;
  }

  // PAUSED fora de propósito: pausar tem motivo humano (docs/domains/
  // experiments.md §21), e retomar por relógio apagaria essa decisão.
  return null;
}

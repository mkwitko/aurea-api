import { Queue } from 'bullmq';
import { env } from '../config/env.js';
import { getConnection } from '../ai/queue/queue.js';

export const ACTION_EXECUTIONS_QUEUE = 'action-executions';

/**
 * Os dois ids viajam juntos, e o processor reconfere os dois: o `workspaceId` não
 * é decoração, é a fronteira. Uma Action lida sem ele publicaria com o profile de
 * quem enfileirou, e a chave do provider é a mesma para todos os clientes
 * (spec §5.1).
 */
export type ActionExecutionJob = { actionId: string; workspaceId: string };

/** `poll` é o número da leitura, começando em 0. */
export type ActionPollJob = ActionExecutionJob & { poll: number };

export const EXECUTE_JOB = 'execute';
export const POLL_JOB = 'poll';

/**
 * O ritmo do poll: rápido no começo, porque a maioria completa em segundos, e
 * espaçado depois, para as 20 leituras não se gastarem nos três primeiros
 * minutos. Depois do último valor, repete o último.
 */
const POLL_DELAYS_MS = [2_000, 3_000, 5_000, 8_000, 13_000, 21_000, 30_000];

export function pollDelay(poll: number): number {
  return POLL_DELAYS_MS[Math.min(poll, POLL_DELAYS_MS.length - 1)] ?? 30_000;
}

let queue: Queue<ActionExecutionJob | ActionPollJob> | undefined;

/**
 * Fila própria, conexão compartilhada com a dos agent runs: são trabalhos
 * diferentes com concorrência e retry diferentes, no mesmo Redis.
 */
export function getActionQueue(): Queue<ActionExecutionJob | ActionPollJob> {
  queue ??= new Queue<ActionExecutionJob | ActionPollJob>(ACTION_EXECUTIONS_QUEUE, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: env.ACTION_EXECUTION_ATTEMPTS,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 3_600, count: 1_000 },
      removeOnFail: { age: 86_400 },
    },
  });
  return queue;
}

/**
 * `jobId` é o id da ação: enquanto o job existe, o BullMQ recusa duplicado.
 * Não é a defesa principal da idempotência — `removeOnComplete` acaba apagando
 * o job — mas fecha a janela quente entre dois cliques (spec §8.1, camada 2).
 */
export async function enqueueActionExecution(job: ActionExecutionJob): Promise<void> {
  await getActionQueue().add(EXECUTE_JOB, job, { jobId: job.actionId });
}

/**
 * A próxima leitura de status.
 *
 * `attempts: 1` de propósito: retentar uma leitura é problema nosso, pelo
 * contador de polls, e não do BullMQ. Com dois mecanismos, um esgotaria enquanto
 * o outro ainda contava — e a ação ficaria `EXECUTING` sem ninguém para fechá-la.
 *
 * O `jobId` leva o número da leitura porque, sem o sufixo, o segundo poll seria
 * recusado como duplicado do primeiro.
 */
export async function enqueueActionPoll(job: ActionPollJob): Promise<void> {
  await getActionQueue().add(POLL_JOB, job, {
    jobId: `${job.actionId}:poll:${job.poll}`,
    delay: pollDelay(job.poll),
    attempts: 1,
  });
}

export async function closeActionQueue(): Promise<void> {
  await queue?.close();
  queue = undefined;
}

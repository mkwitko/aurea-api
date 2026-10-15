import { Worker } from 'bullmq';
import { getConnection } from '../ai/queue/queue.js';
import {
  ACTION_EXECUTIONS_QUEUE,
  POLL_JOB,
  type ActionExecutionJob,
  type ActionPollJob,
} from './queue.js';
import { executeAction, type ActionProcessorDeps } from './processor.js';
import { pollAction } from './poll.js';
import { writeAggregatedStatus } from './aggregate.js';

type Execute = (deps: ActionProcessorDeps, job: ActionExecutionJob) => Promise<void>;
type Poll = (deps: ActionProcessorDeps, job: ActionPollJob) => Promise<void>;

/**
 * Um processador para os dois tipos de job da fila.
 *
 * `execute` pede a publicação; `poll` lê o desfecho. Vivem na mesma fila porque
 * pertencem à mesma ação e à mesma concorrência — e separados por `job.name`
 * porque o que fazem com uma falha é oposto: publicar não pode retentar sem saber
 * se criou, ler pode sempre.
 */
export function createActionProcessor(
  deps: ActionProcessorDeps,
  handlers: { execute?: Execute; poll?: Poll } = {},
) {
  const execute = handlers.execute ?? executeAction;
  const poll = handlers.poll ?? pollAction;

  return async (job: { name: string; data: ActionExecutionJob | ActionPollJob }): Promise<void> => {
    try {
      if (job.name === POLL_JOB) {
        await poll(deps, job.data as ActionPollJob);
        return;
      }
      await execute(deps, job.data as ActionExecutionJob);
    } catch (error) {
      // O processor só relança o que é retentável, e já gravou o motivo nos
      // alvos. Chegar aqui é o sinal para o BullMQ tentar de novo.
      deps.logger.error({ actionId: job.data.actionId, err: error }, 'action job failed');
      throw error;
    }
  };
}

/**
 * Fecha os alvos cujo job de execução esgotou as tentativas.
 *
 * Sem isto, eles ficariam `PUBLISHING` até o reaper passar — e o reaper só sabe
 * dizer "sem sinal de vida", o que apagaria a razão real e mandaria o fundador
 * conferir a rede.
 *
 * O desfecho depende do que se sabe, **por alvo**: `RATE_LIMIT` e `PROVIDER` são
 * as únicas falhas que o processor relança, e as duas significam que o provider
 * respondeu e não criou nada — em toda tentativa. Então é `FAILED`, retentável sem
 * conferir rede nenhuma. Qualquer outra coisa que chegue aqui (o processo morreu
 * antes de gravar o motivo, um erro fora do caminho previsto) não tem essa
 * garantia, e aí vale a regra conservadora: `DELIVERY_UNKNOWN`.
 */
export async function reconcileExhaustedAction(deps: ActionProcessorDeps, actionId: string): Promise<void> {
  const action = await deps.prisma.action.findUnique({ where: { id: actionId }, select: { status: true } });
  // Já resolvido pelo poll ou por um humano: o desfecho dele é o que vale.
  if (!action || action.status !== 'EXECUTING') return;

  const flying = await deps.prisma.actionTarget.findMany({
    where: { actionId, status: 'PUBLISHING' },
    select: { id: true, lastError: true, failureKind: true },
  });

  for (const target of flying) {
    const answered = target.failureKind === 'RATE_LIMIT' || target.failureKind === 'PROVIDER';
    await deps.prisma.actionTarget.updateMany({
      where: { id: target.id, status: 'PUBLISHING' },
      data: {
        status: answered ? 'FAILED' : 'DELIVERY_UNKNOWN',
        // A mensagem da fonte é preservada: "slow down" diz o que aconteceu, e
        // sobrescrevê-la com um texto nosso perderia a única pista que existe.
        lastError: target.lastError ?? 'the execution job ran out of attempts',
      },
    });
  }

  await writeAggregatedStatus(deps.prisma, actionId, { heartbeatAt: null });
  deps.logger.info({ actionId, targets: flying.length }, 'reconciled an action whose job ran out of attempts');
}

/**
 * Concorrência 1 de propósito: publicações de um mesmo workspace disputariam
 * limite de taxa do provider, e o ganho de paralelizar uma chamada HTTP curta
 * não paga o risco.
 *
 * O `failed` cobre o job que esgotou tentativas; o reaper cobre o processo que
 * morreu sem chegar a emitir `failed`.
 */
export function startActionWorker(deps: ActionProcessorDeps): Worker<ActionExecutionJob | ActionPollJob> {
  const worker = new Worker<ActionExecutionJob | ActionPollJob>(
    ACTION_EXECUTIONS_QUEUE,
    createActionProcessor(deps),
    { connection: getConnection(), concurrency: 1 },
  );

  // `failed` é emitido a cada tentativa. Só a última fecha os alvos —
  // reconciliar na primeira mataria a retentativa que o backoff ainda vai fazer.
  worker.on('failed', (job) => {
    if (!job) return;
    // Jobs de poll não passam por aqui: o contador de leituras é que decide
    // quando desistir, e reconciliar por causa de uma leitura que falhou fecharia
    // uma publicação que ainda estava em andamento.
    if (job.name === POLL_JOB) return;
    const limit = job.opts.attempts ?? 1;
    if (job.attemptsMade < limit) return;
    void reconcileExhaustedAction(deps, job.data.actionId);
  });

  return worker;
}

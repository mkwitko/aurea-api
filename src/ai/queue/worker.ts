import { Worker } from 'bullmq';
import { env } from '../../config/env.js';
import { executeAgentRun, type RunnerDeps } from '../runner/runner.js';
import { AGENT_RUNS_QUEUE, getConnection, type AgentRunJob } from './queue.js';

type Execute = (deps: RunnerDeps, agentRunId: string) => Promise<void>;

export function createAgentRunProcessor(deps: RunnerDeps, execute: Execute = executeAgentRun) {
  return async (job: { data: AgentRunJob }): Promise<void> => {
    try {
      await execute(deps, job.data.agentRunId);
    } catch (error) {
      // Falha de negócio já virou FAILED dentro do runner. Chegar aqui é
      // infraestrutura, e aí a retentativa do BullMQ faz sentido.
      deps.logger.error({ agentRunId: job.data.agentRunId, err: error }, 'agent run job failed');
      throw error;
    }
  };
}

export function startAgentRunWorker(deps: RunnerDeps): Worker<AgentRunJob> {
  const worker = new Worker<AgentRunJob>(AGENT_RUNS_QUEUE, createAgentRunProcessor(deps), {
    connection: getConnection(),
    concurrency: env.AI_WORKER_CONCURRENCY,
  });

  // O runner marca FAILED de dentro. O que ele não alcança é a morte do
  // processo no meio de um run — em dev, todo reload do tsx watch; em produção,
  // um deploy ou um OOM. Aí a linha do AgentRun fica RUNNING para sempre, o
  // crédito já foi debitado, e a tela do fundador espera um resultado que não
  // vem mais.
  //
  // O BullMQ detecta o job travado e, esgotadas as tentativas, emite `failed`.
  // É o único lugar de onde dá para reconciliar a linha.
  worker.on('failed', (job, error) => {
    const agentRunId = job?.data.agentRunId;
    if (!agentRunId) return;
    void reconcileDeadRun(deps, agentRunId, error);
  });

  return worker;
}

/**
 * Fecha os runs que pararam de dar sinal de vida.
 *
 * O evento `failed` só cobre o job que o BullMQ ainda conhece. Fora disso —
 * job perdido entre o insert e o enqueue, fila apagada, worker derrubado antes
 * de registrar a falha — a linha fica PENDING/RUNNING para sempre: o crédito
 * segue debitado e, pior, a deduplicação por inputHash devolve esse fantasma a
 * cada nova tentativa, então o fundador nunca mais consegue rodar aquela tarefa.
 *
 * O heartbeat é o que separa lento de morto: quem ainda fala com o modelo
 * carimba a data a cada chamada.
 */
export async function reapStaleRuns(
  deps: RunnerDeps,
  options: { staleMs?: number; limit?: number; now?: Date } = {},
): Promise<number> {
  const staleMs = options.staleMs ?? env.AI_RUN_STALE_MS;
  const now = options.now ?? new Date();
  const stale = await deps.repo.findStale(new Date(now.getTime() - staleMs), options.limit ?? 100);

  for (const run of stale) {
    await reconcileDeadRun(deps, run.id, new Error(`no heartbeat for ${Math.round(staleMs / 1000)}s`));
  }
  return stale.length;
}

/**
 * Roda o reaper no boot e em intervalo fixo. `unref` para não segurar o
 * processo aberto no desligamento.
 */
export function startStaleRunReaper(deps: RunnerDeps): NodeJS.Timeout {
  const tick = async (): Promise<void> => {
    try {
      const reaped = await reapStaleRuns(deps);
      if (reaped > 0) deps.logger.info({ reaped }, 'reaped runs without a heartbeat');
    } catch (error) {
      deps.logger.error({ err: error }, 'the stale run reaper failed');
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), env.AI_RUN_REAPER_INTERVAL_MS);
  timer.unref();
  return timer;
}

/**
 * Fecha um run que morreu sem passar pelo runner.
 *
 * Só age sobre um run ainda RUNNING ou PENDING: se o runner já concluiu ou já
 * marcou FAILED, o resultado dele é o que vale, e sobrescrever apagaria um
 * resultado que o fundador pagou. O estorno é o mesmo caminho de qualquer
 * falha — `onRunFailed` é idempotente pela unique de (agentRunId, kind).
 */
async function reconcileDeadRun(deps: RunnerDeps, agentRunId: string, error: Error): Promise<void> {
  try {
    const run = await deps.repo.findById(agentRunId);
    if (!run || (run.status !== 'RUNNING' && run.status !== 'PENDING')) return;

    // Zeros no uso: o que o run gastou antes de morrer ficou no processo que
    // morreu com ele. Registrar zero é honesto — inventar um número não seria.
    await deps.repo.markFailed(agentRunId, {
      error: `run did not finish: ${error.message}`,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
      modelCalls: run.modelCalls,
    });
    // O crédito já foi debitado na autorização. Sem este estorno o fundador
    // paga por um run que morreu sem entregar nada. `onRunFailed` ignora o
    // tenant na implementação de billing e é idempotente pela unique de
    // (agentRunId, kind), então uma reconciliação repetida não estorna duas
    // vezes.
    await deps.policy.onRunFailed(
      { userId: run.requestedBy ?? 'system', organizationId: '', workspaceId: run.workspaceId, role: 'MEMBER' },
      agentRunId,
    );
    deps.logger.info({ agentRunId }, 'reconciled a run whose process died');
  } catch (reconcileError) {
    // Reconciliar é melhor-esforço: falhar aqui não pode derrubar o worker.
    deps.logger.error({ agentRunId, err: reconcileError }, 'could not reconcile a dead run');
  }
}

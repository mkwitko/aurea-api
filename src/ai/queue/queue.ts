import { Queue } from 'bullmq';
// Named export: sob NodeNext o default de ioredis é o namespace do módulo, não a classe.
import { Redis } from 'ioredis';
import { env } from '../../config/env.js';

export const AGENT_RUNS_QUEUE = 'agent-runs';

export type AgentRunJob = { agentRunId: string };

let connection: Redis | undefined;
let queue: Queue<AgentRunJob> | undefined;

// BullMQ exige maxRetriesPerRequest: null na conexão usada por workers.
export function getConnection(): Redis {
  connection ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return connection;
}

export function getQueue(): Queue<AgentRunJob> {
  queue ??= new Queue<AgentRunJob>(AGENT_RUNS_QUEUE, {
    connection: getConnection(),
    defaultJobOptions: {
      // attempts cobre queda de Redis/DB. O teto de custo é modelCalls, no banco.
      attempts: 2,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { age: 3_600, count: 1_000 },
      removeOnFail: { age: 86_400 },
    },
  });
  return queue;
}

export async function enqueueAgentRun(job: AgentRunJob): Promise<void> {
  await getQueue().add('execute', job, { jobId: job.agentRunId });
}

/**
 * Tira da fila um run cancelado. Best-effort de propósito: se o job já está
 * sendo executado o BullMQ recusa a remoção, e aí quem para o run é o próprio
 * runner, que relê o status entre chamadas de modelo. A fonte de verdade do
 * cancelamento é o banco, nunca a fila.
 */
export async function removeAgentRunJob(agentRunId: string): Promise<void> {
  try {
    await getQueue().remove(agentRunId);
  } catch {
    // Job ativo ou já removido: o cancelamento no banco basta.
  }
}

export async function closeQueue(): Promise<void> {
  await queue?.close();
  await connection?.quit();
  queue = undefined;
  connection = undefined;
}

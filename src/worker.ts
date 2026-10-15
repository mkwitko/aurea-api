import { PrismaClient } from '@prisma/client';
import { env } from './config/env.js';
import { startAgentRunWorker, startStaleRunReaper } from './ai/queue/worker.js';
import { createWorkerDeps } from './ai/queue/worker-deps.js';
import { closeQueue } from './ai/queue/queue.js';
import { flushTracing } from './integrations/tracing/index.js';
import { startExperimentClock } from './schedule/experiment-clock.js';
import { createExperimentsRepository } from './http/api/experiments/experiments.repository.js';
import { startActionWorker } from './actions/worker.js';
import { startActionReaper } from './actions/reaper.js';
import { closeActionQueue } from './actions/queue.js';

/**
 * O processo do worker de IA. Roda separado da API de propósito.
 *
 * Enquanto ele vivia dentro do `app.ts`, todo restart da API matava os runs em
 * voo: em desenvolvimento cada save recarregava o `tsx watch`, em produção cada
 * deploy fazia o mesmo. O run ficava RUNNING para sempre, o crédito já
 * debitado, e a tela do fundador esperando um resultado que não vinha.
 *
 * Separado, a API pode reiniciar quantas vezes quiser sem tocar em trabalho
 * pago — e este processo pode escalar por conta, já que o gargalo dele é
 * chamada de modelo e não requisição HTTP.
 */
// O logger que o RunnerDeps pede é só `info`/`error` sobre um objeto — o
// mesmo contrato que o log do Fastify cumpre na API. Aqui um console
// estruturado basta e evita puxar o pino como dependência direta só por isto.
const logger = {
  info: (obj: object, msg: string) => console.log(JSON.stringify({ level: 'info', msg, ...obj })),
  error: (obj: object, msg: string) => console.error(JSON.stringify({ level: 'error', msg, ...obj })),
};
const prisma = new PrismaClient();

const deps = createWorkerDeps(prisma, logger);
const worker = startAgentRunWorker(deps);
// No boot também: os runs que ficaram presos enquanto o processo esteve fora
// não têm mais job na fila para emitir `failed`.
const reaper = startStaleRunReaper(deps);
// O relógio de domínio vive no mesmo processo do worker, e não na API, pela
// mesma razão que o reaper: a API reinicia a cada deploy, e um intervalo que
// morre a cada deploy não é um relógio.
const clock = startExperimentClock({ repo: createExperimentsRepository(prisma), logger });

// A execução de ações vive no mesmo processo do worker de IA, e pela mesma
// razão: a API reinicia a cada deploy, e uma publicação em voo não pode morrer
// com ela. O reaper ao lado, porque é ele quem fecha o que morreu.
const actionWorker = startActionWorker({ prisma, logger });
const actionReaper = startActionReaper({ prisma, logger });

logger.info({ concurrency: env.AI_WORKER_CONCURRENCY }, 'ai worker started');

let shuttingDown = false;

const shutdown = async (signal: string): Promise<void> => {
  // Um segundo SIGTERM durante o desligamento não pode reentrar aqui: o
  // `worker.close()` abaixo espera os jobs em voo, e chamá-lo duas vezes
  // abandonaria justamente o que ele existe para proteger.
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, 'shutting down the ai worker');
  clearInterval(reaper);
  clearInterval(clock);
  clearInterval(actionReaper);
  try {
    // Espera os jobs em voo terminarem. É a diferença entre um deploy que
    // conclui os runs pagos e um que os abandona pela metade.
    await worker.close();
    await closeQueue();
    await actionWorker.close();
    await closeActionQueue();
    await flushTracing();
    await prisma.$disconnect();
  } catch (error) {
    logger.error({ err: error }, 'the ai worker did not shut down cleanly');
  }
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

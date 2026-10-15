import type { PrismaClient } from '@prisma/client';
import { env } from '../../config/env.js';
import { createAgentRunRepository } from '../agent-run/agent-run.repository.js';
import { createBillingPolicy } from '../policy.js';
import { createCreditService } from '../../billing/credit.service.js';
import { createCreditRepository } from '../../billing/credit.repository.js';
import { createProviderKeyService } from '../../billing/provider-key.service.js';
import { createProviderKeyRepository } from '../../billing/provider-key.repository.js';
import { verifyProviderKey } from '../../billing/verify-provider-key.js';
import { createDeepSeekProvider } from '../providers/openai-compatible.js';
import type { RunnerDeps } from '../runner/runner.js';

/**
 * Tudo que o worker precisa para executar um run, montado num lugar só.
 *
 * Extraído de `app.ts` quando o worker saiu de dentro do processo da API. Ele
 * vivia lá dentro, e por isso todo reload do `tsx watch` em desenvolvimento — e
 * todo deploy ou OOM em produção — matava os runs em voo, deixando a linha do
 * AgentRun em RUNNING para sempre com o crédito já debitado. Um processo
 * próprio (`src/worker.ts`) desacopla as duas coisas: reiniciar a API deixa de
 * tocar em trabalho pago.
 */
export function createWorkerDeps(
  prisma: PrismaClient,
  logger: RunnerDeps['logger'],
): RunnerDeps {
  const credits = createCreditService({ repo: createCreditRepository(prisma) });
  const keys = createProviderKeyService({
    repo: createProviderKeyRepository(prisma),
    verify: verifyProviderKey,
  });

  return {
    prisma,
    repo: createAgentRunRepository(prisma),
    policy: createBillingPolicy({ credits, keys, platformApiKey: env.AI_PROVIDER_API_KEY }),
    createProvider: (_name, credentials) => createDeepSeekProvider(credentials.apiKey),
    logger,
  };
}

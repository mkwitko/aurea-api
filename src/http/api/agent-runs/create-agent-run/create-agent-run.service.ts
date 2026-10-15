import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { getAgent } from '../../../../ai/agents/registry.js';
import { env } from '../../../../config/env.js';
import { isSearchConfigured } from '../../../../integrations/search/index.js';
import { AgentRunInProgressError, BadRequestError, SearchNotConfiguredError, UnknownTaskTypeHttpError } from '../../../../lib/errors.js';
import { assertWriter, type TenantContext } from '../../../../lib/tenant.js';
import type { AgentRunRepository } from '../../../../ai/agent-run/agent-run.repository.js';

// JSON canônico: chaves ordenadas, para que a mesma entrada em ordem
// diferente produza o mesmo hash e caia na deduplicação.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

export function hashInput(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex');
}

// Mesmo critério do reaper (ai/queue/worker.ts): o heartbeat é o sinal de que
// o run ainda está sendo executado por algum processo.
function isAlive(run: { heartbeatAt: Date | null; createdAt: Date }, now = new Date()): boolean {
  const lastSign = run.heartbeatAt ?? run.createdAt;
  return now.getTime() - lastSign.getTime() < env.AI_RUN_STALE_MS;
}

export type CreateAgentRunDeps = {
  repo: AgentRunRepository;
  enqueue(job: { agentRunId: string }): Promise<void>;
  prisma: PrismaClient;
};

export function createAgentRunService(deps: CreateAgentRunDeps) {
  return async ({
    tenant,
    taskType,
    input,
  }: {
    tenant: TenantContext;
    taskType: string;
    input: unknown;
  }) => {
    assertWriter(tenant);

    const agent = getAgent(taskType);
    if (!agent) throw new UnknownTaskTypeHttpError({ taskType });

    // authorizeRun acontece dentro do worker, então sem esta recusa o cliente
    // pagaria créditos por um run que não tem como funcionar.
    if (agent.requiresSearch && !isSearchConfigured()) throw new SearchNotConfiguredError();

    const parsed = agent.inputSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestError(
        'Invalid input for this task type',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }

    // Depois do parse (o precheck lê campos do input já validado) e antes de
    // qualquer escrita ou cobrança.
    if (agent.precheck) await agent.precheck(parsed.data, { prisma: deps.prisma, tenant });

    const inputHash = hashInput(parsed.data);

    // Escopo declarado pelo agente. O padrão só cobre o pedido idêntico; um
    // agente que escreve numa área compartilhada declara uma chave mais larga
    // e serializa tudo que disputa aquela área.
    const concurrencyKey = agent.concurrencyKey?.(parsed.data) ?? `${taskType}:${inputHash}`;

    // Só conta o run que ainda dá sinal de vida: sem esta checagem, um run
    // cujo processo morreu bloqueia aquele escopo para sempre — toda tentativa
    // recebe o fantasma de volta e nada é enfileirado. Quem fecha e estorna a
    // linha morta é o reaper do worker; aqui só a ignoramos, para o fundador
    // não esperar o próximo ciclo.
    const active = await deps.repo.findActiveByKey(tenant.workspaceId, concurrencyKey);
    if (active && isAlive(active)) {
      // Mesmo pedido: é o clique duplo, e devolver o run em voo é exatamente o
      // que impede a segunda cobrança.
      if (active.inputHash === inputHash) return active;
      // Pedido diferente no mesmo escopo: recusa explícita, com o run que está
      // ocupando o lugar. Devolver o run alheio como se fosse a resposta deste
      // pedido — o que este serviço fazia antes — faz a tela esperar por um
      // resultado sobre outra coisa.
      throw new AgentRunInProgressError({
        runId: active.id,
        taskType: active.taskType,
        startedAt: (active.startedAt ?? active.createdAt).toISOString(),
      });
    }

    const run = await deps.repo.create({
      workspaceId: tenant.workspaceId,
      agentType: agent.agentType,
      taskType,
      tier: agent.tier,
      input: parsed.data as object,
      inputHash,
      concurrencyKey,
      requestedBy: tenant.userId,
    });

    await deps.enqueue({ agentRunId: run.id });
    return run;
  };
}

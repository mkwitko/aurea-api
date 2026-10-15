import { Prisma } from '@prisma/client';
import type { AgentRunStatus, PrismaClient } from '@prisma/client';

export type CreateAgentRunInput = {
  workspaceId: string;
  agentType: string;
  taskType: string;
  tier: string;
  input: Prisma.InputJsonValue;
  inputHash: string;
  concurrencyKey: string;
  requestedBy: string;
};

export type RunUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  modelCalls: number;
};

export function createAgentRunRepository(prisma: PrismaClient) {
  return {
    create(input: CreateAgentRunInput) {
      return prisma.agentRun.create({
        data: {
          workspaceId: input.workspaceId,
          agentType: input.agentType,
          taskType: input.taskType,
          tier: input.tier,
          status: 'PENDING',
          input: input.input,
          inputHash: input.inputHash,
          concurrencyKey: input.concurrencyKey,
          requestedBy: input.requestedBy,
          queuedAt: new Date(),
          // Nasce vivo: um run que nunca chega a rodar (job perdido no
          // enqueue, redis limpo) fica sem heartbeat nenhum, e o reaper
          // precisa de uma data para decidir que ele já esperou demais.
          heartbeatAt: new Date(),
        },
      });
    },

    // O run em voo que ocupa este escopo, se houver. A chave (ver
    // AgentDefinition.concurrencyKey) é o que define "mesmo escopo": pode ser
    // o pedido idêntico, pode ser toda a área que o agente escreve.
    findActiveByKey(workspaceId: string, concurrencyKey: string) {
      return prisma.agentRun.findFirst({
        where: { workspaceId, concurrencyKey, status: { in: ['PENDING', 'RUNNING'] } },
        orderBy: { createdAt: 'desc' },
      });
    },

    // Cancelamento parte do HTTP, então é escopado por workspace — e
    // condicional ao estado: um run que já terminou não pode ser cancelado
    // por cima, o resultado que o fundador pagou continua valendo.
    // Devolve false quando não havia nada a cancelar.
    async cancel(id: string, workspaceId: string): Promise<boolean> {
      const { count } = await prisma.agentRun.updateMany({
        where: { id, workspaceId, status: { in: ['PENDING', 'RUNNING'] } },
        data: { status: 'CANCELLED', completedAt: new Date(), error: 'cancelled by the user' },
      });
      return count > 0;
    },

    findInWorkspace(id: string, workspaceId: string) {
      return prisma.agentRun.findFirst({
        where: { id, workspaceId },
        include: { toolCalls: { orderBy: { startedAt: 'asc' } } },
      });
    },

    // status usa o enum do Prisma (idêntico ao z.enum da rota) em vez de
    // string + cast: os literais batem exatamente, sem precisar mentir pro compilador.
    listInWorkspace(
      workspaceId: string,
      filters: { taskType?: string; status?: AgentRunStatus; limit: number },
    ) {
      return prisma.agentRun.findMany({
        where: {
          workspaceId,
          ...(filters.taskType ? { taskType: filters.taskType } : {}),
          ...(filters.status ? { status: filters.status } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: filters.limit,
      });
    },

    // Worker-only entry point: the worker has no request tenant to scope by.
    // HTTP paths must use findInWorkspace instead, never this method.
    findById(id: string) {
      return prisma.agentRun.findUnique({ where: { id } });
    },

    // Worker-only entry point: intentionally not workspace-scoped (see findById).
    // updateMany com filtro de status em vez de update por id: um run que o
    // fundador cancelou não pode ser ressuscitado por um processo que só
    // descobre isso depois. `count === 0` significa "alguém já fechou este
    // run" — o chamador para por aí.
    markRunning(id: string) {
      return prisma.agentRun.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'RUNNING', startedAt: new Date(), heartbeatAt: new Date() },
      });
    },

    // Worker-only entry point: intentionally not workspace-scoped (see findById).
    touchHeartbeat(id: string) {
      return prisma.agentRun.update({ where: { id }, data: { heartbeatAt: new Date() } });
    },

    // Runs que não dão sinal de vida desde `before`. É a única forma de fechar
    // um run cujo processo morreu sem o BullMQ emitir `failed` — job perdido no
    // enqueue, fila apagada, worker derrubado antes de registrar a falha.
    findStale(before: Date, limit: number) {
      return prisma.agentRun.findMany({
        where: {
          status: { in: ['PENDING', 'RUNNING'] },
          // `heartbeatAt: null` são as linhas anteriores a esta coluna: elas
          // também estão presas e caem no reaper pela data de criação.
          OR: [{ heartbeatAt: { lt: before } }, { heartbeatAt: null, createdAt: { lt: before } }],
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });
    },

    // Worker-only entry point: intentionally not workspace-scoped (see findById).
    markCompleted(
      id: string,
      input: RunUsage & {
        output: Prisma.InputJsonValue;
        model: string;
        provider: string;
        tier: string;
      },
    ) {
      return prisma.agentRun.updateMany({
        where: { id, status: { in: ['PENDING', 'RUNNING'] } },
        data: { ...input, status: 'COMPLETED', completedAt: new Date() },
      });
    },

    // Worker-only entry point: intentionally not workspace-scoped (see findById).
    markFailed(
      id: string,
      input: RunUsage & {
        error: string;
        model?: string;
        provider?: string;
        tier?: string;
      },
    ) {
      return prisma.agentRun.updateMany({
        where: { id, status: { in: ['PENDING', 'RUNNING'] } },
        data: { ...input, status: 'FAILED', completedAt: new Date() },
      });
    },

    // Worker-only entry point: intentionally not workspace-scoped (see findById).
    async recordToolCall(input: {
      agentRunId: string;
      name: string;
      args: Prisma.InputJsonValue;
      result: Prisma.InputJsonValue | null;
      ok: boolean;
      error: string | null;
      durationMs: number;
      startedAt: Date;
    }) {
      await prisma.agentToolCall.create({
        data: { ...input, result: input.result ?? Prisma.JsonNull },
      });
    },
  };
}

export type AgentRunRepository = ReturnType<typeof createAgentRunRepository>;

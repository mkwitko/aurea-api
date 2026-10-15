import { z } from 'zod';

export const createAgentRunBody = z.object({
  taskType: z.string().min(1),
  input: z.unknown(),
});

export const agentRunParams = z.object({ id: z.string().uuid() });

export const agentRunResponse = z.object({
  id: z.string(),
  taskType: z.string(),
  agentType: z.string(),
  status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']),
  // Sem isso, um cliente que recupera um run (por reload, ou pela lista) não
  // tem como dizer sobre o que ele raciocinou — o goalId, por exemplo, só
  // existe aqui, nunca de volta no body do POST original.
  input: z.unknown().nullable(),
  output: z.unknown().nullable(),
  error: z.string().nullable(),
  model: z.string().nullable(),
  // Sem estimatedCost: dinheiro é auditoria interna, o cliente conta em
  // créditos (ver o spec do B2a, §3). O valor continua no AgentRun.
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  // Calculado a partir do agentRunId (ver integrations/tracing/trace-url.ts),
  // não uma coluna — null quando o Langfuse não está configurado.
  traceUrl: z.string().url().nullable(),
});

export type CreateAgentRunBody = z.infer<typeof createAgentRunBody>;

export const agentRunStatus = z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']);

export const listAgentRunsQuery = z.object({
  taskType: z.string().min(1).optional(),
  status: agentRunStatus.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const agentRunListResponse = z.object({ runs: z.array(agentRunResponse) });

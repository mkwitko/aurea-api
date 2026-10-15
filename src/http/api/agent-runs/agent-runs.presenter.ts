import type { AgentRun } from '@prisma/client';
import { traceUrlFor } from '../../../integrations/tracing/index.js';

export async function presentAgentRun(run: AgentRun) {
  return {
    id: run.id,
    taskType: run.taskType,
    agentType: run.agentType,
    status: run.status,
    input: run.input ?? null,
    output: run.output ?? null,
    error: run.error ?? null,
    model: run.model ?? null,
    createdAt: run.createdAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    traceUrl: await traceUrlFor(run.id),
  };
}

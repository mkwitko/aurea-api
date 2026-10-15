import {
  LearningAlreadyAcceptedError,
  NotFoundError,
  RunInputUnreadableError,
  RunNotCompletedError,
  RunNotInterpretationError,
  RunOutputUnreadableError,
} from '../../../../lib/errors.js';
import { interpretOutcomeAgent } from '../../../../ai/agents/interpret-outcome.js';
import type { LearningsRepository } from '../learnings.repository.js';

export type FromRunDeps = {
  repo: LearningsRepository;
  findRun(id: string, workspaceId: string): Promise<{
    taskType: string;
    status: string;
    input: unknown;
    output: unknown;
  } | null>;
};

// Mesma tradução de P2002 do create-from-proposal, e pela mesma razão: o
// Postgres relata o alvo de três formas (array de colunas, nome do índice
// solto, ou array de um elemento), e testar só Array.isArray deixa duas
// escaparem como 500. O índice aqui chama-se Learning_sourceAgentRunId_key,
// então um predicado por substring cobre as três.
const isAlreadyAcceptedViolation = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const { code, meta } = error as { code?: string; meta?: { target?: unknown } };
  if (code !== 'P2002') return false;
  const target = meta?.target;
  const text = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return text.includes('sourceAgentRunId');
};

export function learningFromRunService(deps: FromRunDeps) {
  return async (input: { agentRunId: string; workspaceId: string }) => {
    const run = await deps.findRun(input.agentRunId, input.workspaceId);
    if (!run) throw new NotFoundError('Agent run not found');
    if (run.taskType !== interpretOutcomeAgent.taskType) throw new RunNotInterpretationError();
    if (run.status !== 'COMPLETED') throw new RunNotCompletedError();

    // O experimento vem do input do run, nunca do corpo do pedido.
    const parsedInput = interpretOutcomeAgent.inputSchema.safeParse(run.input);
    if (!parsedInput.success) throw new RunInputUnreadableError();

    // Reparsear a saída: um run anterior a uma mudança de schema é recusado
    // em vez de lido pela metade.
    const parsedOutput = interpretOutcomeAgent.outputSchema.safeParse(run.output);
    if (!parsedOutput.success) throw new RunOutputUnreadableError();
    const { reading, caveats, learning } = parsedOutput.data;

    try {
      return await deps.repo.createFromRun(input.workspaceId, {
        experimentId: parsedInput.data.experimentId,
        sourceAgentRunId: input.agentRunId,
        title: learning.title,
        statement: learning.statement,
        confidence: learning.confidence,
        evidence: { points: learning.evidence, reading, caveats },
      });
    } catch (error) {
      if (isAlreadyAcceptedViolation(error)) throw new LearningAlreadyAcceptedError();
      throw error;
    }
  };
}

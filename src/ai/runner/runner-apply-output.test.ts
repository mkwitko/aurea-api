import { describe, expect, it, vi } from 'vitest';
import { executeAgentRun } from './runner.js';
import { harness, RUN, finalAnswer } from './runner.harness.js';
import { AGENT_REGISTRY } from '../agents/registry.js';

// AgentDefinition.applyOutput (ver ai/agents/registry.ts) roda dentro do
// runner, depois de verifyOutput e antes de markCompleted — o hook que a
// Fase 2 do redesign de onboarding usa para gravar direto no Growth Brain em
// vez de deixar o resultado só em AgentRun.output. Mesmo padrão de
// runner-build-failure.test.ts: clona um agente real do registro sob uma
// taskType nova, em vez de mutar um dos sete agentes de preenchimento.
describe('executeAgentRun — applyOutput', () => {
  it('runs applyOutput with prisma, workspaceId and runId, before markCompleted', async () => {
    const baseAgent = AGENT_REGISTRY[RUN.taskType]!;
    const taskType = `apply-output-success-test-${Math.random()}`;
    const calls: string[] = [];
    const applyOutput = vi.fn(async (_output: unknown, _ctx: unknown) => {
      calls.push('applyOutput');
    });
    AGENT_REGISTRY[taskType] = { ...baseAgent, taskType, applyOutput };

    try {
      const { deps, repo, prisma } = harness([finalAnswer()]);
      repo.markCompleted.mockImplementation(async () => {
        calls.push('markCompleted');
        return {};
      });
      repo.findById.mockResolvedValue({ ...RUN, taskType });

      await executeAgentRun(deps, 'run-1');

      expect(applyOutput).toHaveBeenCalledOnce();
      const [output, ctx] = applyOutput.mock.calls[0]!;
      expect(output).toMatchObject({ summary: 'Acme sells X' });
      expect(ctx).toEqual({ prisma, workspaceId: 'ws-1', runId: 'run-1' });

      expect(calls).toEqual(['applyOutput', 'markCompleted']);
      expect(repo.markFailed).not.toHaveBeenCalled();
    } finally {
      delete AGENT_REGISTRY[taskType];
    }
  });

  it('fails the run and refunds through the existing fail() path when applyOutput throws, without ever calling markCompleted', async () => {
    const baseAgent = AGENT_REGISTRY[RUN.taskType]!;
    const taskType = `apply-output-failure-test-${Math.random()}`;
    AGENT_REGISTRY[taskType] = {
      ...baseAgent,
      taskType,
      async applyOutput() {
        throw new Error('could not write the context version');
      },
    };

    try {
      const onRunFailed = vi.fn().mockResolvedValue(undefined);
      const { deps, repo } = harness([finalAnswer()]);
      deps.policy = { ...deps.policy, onRunFailed };
      repo.findById.mockResolvedValue({ ...RUN, taskType });

      await executeAgentRun(deps, 'run-1');

      expect(repo.markCompleted).not.toHaveBeenCalled();
      expect(repo.markFailed).toHaveBeenCalledOnce();
      expect(repo.markFailed.mock.calls[0]![1].error).toBe('could not write the context version');
      expect(onRunFailed).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws-1' }), 'run-1');
    } finally {
      delete AGENT_REGISTRY[taskType];
    }
  });

  it('never runs applyOutput for an agent that does not declare it', async () => {
    // Ausência de campo se comporta exatamente como antes desta mudança — a
    // mesma garantia que AgentBudget já documenta para os outros campos
    // opcionais de AgentDefinition.
    const { deps, repo } = harness([finalAnswer()]);

    await executeAgentRun(deps, 'run-1');

    expect(repo.markCompleted).toHaveBeenCalledOnce();
  });
});

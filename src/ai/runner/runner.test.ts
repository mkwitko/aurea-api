import { describe, expect, it, vi } from 'vitest';
import { executeAgentRun } from './runner.js';
import { finalAnswer, harness, RUN } from './runner.harness.js';

describe('executeAgentRun — happy path', () => {
  it('marks the run RUNNING before calling the model', async () => {
    const { deps, repo } = harness([finalAnswer()]);
    await executeAgentRun(deps, 'run-1');
    expect(repo.markRunning).toHaveBeenCalledWith('run-1');
  });

  it('completes with the validated output', async () => {
    const { deps, repo } = harness([finalAnswer()]);
    await executeAgentRun(deps, 'run-1');

    const [, payload] = repo.markCompleted.mock.calls[0]!;
    expect(payload.output).toEqual({ summary: 'Acme sells X', risks: ['a', 'b', 'c'], confidence: 'MEDIUM' });
    expect(payload.modelCalls).toBe(1);
    expect(payload.inputTokens).toBe(100);
    expect(payload.cachedInputTokens).toBe(40);
    expect(payload.estimatedCost).toBeGreaterThan(0);
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('sends the agent tools plus submit_answer, json mode off, on the first call', async () => {
    // json mode e a tool de submit disputariam a mesma saída (ver runner.ts);
    // desde que submit_answer existe, o schema é imposto pela tool, não por
    // response_format.
    const { deps, provider } = harness([finalAnswer()]);
    await executeAgentRun(deps, 'run-1');

    const req = provider.requests[0]!;
    expect(req.jsonMode).toBe(false);
    expect(req.tools?.map((t) => t.name)).toEqual(['get_business_context', 'submit_answer']);
  });

  it('fails the run when the task type is not in the registry', async () => {
    const { deps, repo } = harness([finalAnswer()]);
    repo.findById.mockResolvedValue({ ...RUN, taskType: 'ghost' });

    await executeAgentRun(deps, 'run-1');

    expect(repo.markFailed).toHaveBeenCalled();
    expect(repo.markFailed.mock.calls[0]![1].error).toMatch(/task type/i);
  });

  it('fails the run when authorizeRun denies it', async () => {
    const { deps, repo } = harness([finalAnswer()]);
    deps.policy = { ...deps.policy, authorizeRun: async () => ({ allowed: false, reason: 'no credits' }) };

    await executeAgentRun(deps, 'run-1');

    expect(repo.markFailed.mock.calls[0]![1].error).toContain('no credits');
  });

  it('never calls the provider when the run is not authorized', async () => {
    const { deps, repo, provider } = harness([finalAnswer()]);
    deps.policy = {
      ...deps.policy,
      authorizeRun: async () => ({
        allowed: false,
        reason: 'insufficient credits: needs 1, has 0',
        required: 1,
        available: 0,
      }),
    };

    await executeAgentRun(deps, 'run-1');

    expect(provider.requests).toHaveLength(0);
    expect(repo.markFailed.mock.calls[0]![1].error).toMatch(/insufficient credits/i);
    expect(repo.markFailed.mock.calls[0]![1].modelCalls).toBe(0);
  });

  it('tells the policy when a run fails, so the charge can be refunded', async () => {
    const onRunFailed = vi.fn().mockResolvedValue(undefined);
    const { deps, repo } = harness([finalAnswer()]);
    deps.policy = { ...deps.policy, onRunFailed };
    repo.findById.mockResolvedValue({ ...RUN, taskType: 'ghost-task' });

    await executeAgentRun(deps, 'run-1');

    expect(onRunFailed).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws-1' }), 'run-1');
  });

  it('does nothing when the run is already COMPLETED', async () => {
    const { deps, repo, provider } = harness([finalAnswer()]);
    repo.findById.mockResolvedValue({ ...RUN, status: 'COMPLETED' });

    await executeAgentRun(deps, 'run-1');

    expect(provider.requests).toHaveLength(0);
    expect(repo.markRunning).not.toHaveBeenCalled();
  });
});

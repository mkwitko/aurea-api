import { describe, expect, it } from 'vitest';
import { executeAgentRun } from './runner.js';
import { harness } from './runner.harness.js';
import type { AiCompletion } from '../providers/provider.js';

const bad = (): AiCompletion => ({
  text: '{"summary":"","risks":["a"]}',
  toolCalls: [],
  usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
  finishReason: 'stop',
});

const good = (): AiCompletion => ({
  text: JSON.stringify({ summary: 'ok', risks: ['a', 'b', 'c'], confidence: 'LOW' }),
  toolCalls: [],
  usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
  finishReason: 'stop',
});

describe('executeAgentRun — guardrail policy', () => {
  it('repairs once on the same tier and completes', async () => {
    const { deps, repo, provider } = harness([bad(), good()]);

    await executeAgentRun(deps, 'run-1');

    expect(repo.markCompleted).toHaveBeenCalled();
    expect(provider.requests).toHaveLength(2);
    const repairPrompt = provider.requests[1]!.messages.at(-1)!;
    expect('content' in repairPrompt ? repairPrompt.content : '').toMatch(/did not match the required schema/i);
    expect(repo.markCompleted.mock.calls[0]![1].modelCalls).toBe(2);
  });

  it('escalates to the next tier on the second failure', async () => {
    const { deps, repo, provider } = harness([bad(), bad(), good()]);

    await executeAgentRun(deps, 'run-1');

    expect(provider.requests).toHaveLength(3);
    expect(provider.requests[2]!.modelId).not.toBe(provider.requests[0]!.modelId);
    expect(repo.markCompleted.mock.calls[0]![1].tier).toBe('TIER2');
  });

  it('fails after three model calls and never makes a fourth', async () => {
    const { deps, repo, provider } = harness([bad(), bad(), bad()]);

    await executeAgentRun(deps, 'run-1');

    expect(provider.requests).toHaveLength(3);
    expect(repo.markFailed).toHaveBeenCalled();
    expect(repo.markFailed.mock.calls[0]![1].modelCalls).toBe(3);
  });

  it('bills every attempt, including the failed ones', async () => {
    const { deps, repo } = harness([bad(), bad(), bad()]);

    await executeAgentRun(deps, 'run-1');

    const payload = repo.markFailed.mock.calls[0]![1];
    expect(payload.inputTokens).toBe(30);
    expect(payload.estimatedCost).toBeGreaterThan(0);
  });

  it('respects a budget already spent by a previous job attempt', async () => {
    const { deps, repo, provider } = harness([bad(), good()]);
    repo.findById.mockResolvedValue({
      id: 'run-1', workspaceId: 'ws-1', taskType: 'summarize-business-context',
      agentType: 'context-analyst', tier: 'TIER1', status: 'RUNNING', modelCalls: 2,
      input: { businessId: '3f1e8f6e-1f1a-4f0e-9b0e-0f6d3b7a1c22' }, requestedBy: 'u1',
    });

    await executeAgentRun(deps, 'run-1');

    expect(provider.requests).toHaveLength(1);
    expect(repo.markFailed).toHaveBeenCalled();
  });
});

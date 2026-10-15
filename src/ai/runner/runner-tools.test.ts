import { describe, expect, it, vi } from 'vitest';
import { executeAgentRun } from './runner.js';
import { harness } from './runner.harness.js';
import type { AiCompletion } from '../providers/provider.js';

const toolCall = (args: string): AiCompletion => ({
  text: null,
  toolCalls: [{ id: 'call_1', name: 'get_business_context', args: JSON.parse(args) }],
  usage: { inputTokens: 50, outputTokens: 10, cachedInputTokens: 0 },
  finishReason: 'tool_calls',
});

const badToolCall = (): AiCompletion => ({
  text: null,
  toolCalls: [{ id: 'call_1', name: 'get_business_context', args: { sections: 'company' } }],
  usage: { inputTokens: 50, outputTokens: 10, cachedInputTokens: 0 },
  finishReason: 'tool_calls',
});

const unknownToolCall = (): AiCompletion => ({
  text: null,
  toolCalls: [{ id: 'call_9', name: 'delete_everything', args: {} }],
  usage: { inputTokens: 5, outputTokens: 1, cachedInputTokens: 0 },
  finishReason: 'tool_calls',
});

const finalAnswer = (): AiCompletion => ({
  text: JSON.stringify({ summary: 'Acme sells X', risks: ['a', 'b', 'c'], confidence: 'HIGH' }),
  toolCalls: [],
  usage: { inputTokens: 120, outputTokens: 30, cachedInputTokens: 20 },
  finishReason: 'stop',
});

describe('executeAgentRun — tool loop', () => {
  it('executes the tool and feeds the result back before finishing', async () => {
    const { deps, repo, provider } = harness([toolCall('{"sections":["companyProfile"]}'), finalAnswer()]);

    await executeAgentRun(deps, 'run-1');

    // segunda chamada carrega assistant + tool na conversa
    const second = provider.requests[1]!;
    expect(second.messages.some((m) => m.role === 'tool')).toBe(true);
    expect(repo.markCompleted).toHaveBeenCalled();
  });

  it('records every tool call with its duration', async () => {
    const { deps, repo } = harness([toolCall('{}'), finalAnswer()]);

    await executeAgentRun(deps, 'run-1');

    const call = repo.recordToolCall.mock.calls[0]![0];
    expect(call.name).toBe('get_business_context');
    expect(call.ok).toBe(true);
    expect(typeof call.durationMs).toBe('number');
  });

  it('sums usage across every call in the loop', async () => {
    const { deps, repo } = harness([toolCall('{}'), finalAnswer()]);

    await executeAgentRun(deps, 'run-1');

    const payload = repo.markCompleted.mock.calls[0]![1];
    expect(payload.inputTokens).toBe(170);
    expect(payload.outputTokens).toBe(40);
    expect(payload.modelCalls).toBe(2);
  });

  it('returns invalid tool args to the model instead of failing the run', async () => {
    const { deps, repo, provider } = harness([badToolCall(), finalAnswer()]);

    await executeAgentRun(deps, 'run-1');

    const toolMessage = provider.requests[1]!.messages.find((m) => m.role === 'tool');
    expect(toolMessage && 'content' in toolMessage ? toolMessage.content : '').toMatch(/invalid arguments/i);
    expect(repo.recordToolCall.mock.calls[0]![0].ok).toBe(false);
    expect(repo.markCompleted).toHaveBeenCalled();
  });

  it('answers an unknown tool name with an error result, never executing anything', async () => {
    const { deps, repo, provider } = harness([unknownToolCall(), finalAnswer()]);

    await executeAgentRun(deps, 'run-1');

    const toolMessage = provider.requests[1]!.messages.find((m) => m.role === 'tool');
    expect(toolMessage && 'content' in toolMessage ? toolMessage.content : '').toMatch(/unknown tool/i);
    expect(repo.recordToolCall.mock.calls[0]![0].ok).toBe(false);
  });

  it('records a failed tool call and continues when execute throws', async () => {
    const { deps, repo, provider, prisma } = harness([toolCall('{"sections":["companyProfile"]}'), finalAnswer()]);
    (prisma.business.findFirst as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db connection lost'));

    await executeAgentRun(deps, 'run-1');

    const call = repo.recordToolCall.mock.calls[0]![0];
    expect(call.ok).toBe(false);
    expect(call.error).toBe('db connection lost');

    const toolMessage = provider.requests[1]!.messages.find((m) => m.role === 'tool');
    expect(toolMessage && 'content' in toolMessage ? toolMessage.content : '').toMatch(/db connection lost/);

    expect(repo.markCompleted).toHaveBeenCalled();
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  // O teto efetivo de um modelo preso em tools é o orçamento de chamadas do run
  // (3), não o teto de iterações (5): o orçamento acaba primeiro.
  it('stops a model looping on tools when the model-call budget runs out', async () => {
    const { deps, repo, provider } = harness([
      toolCall('{}'), toolCall('{}'), toolCall('{}'), toolCall('{}'), toolCall('{}'), toolCall('{}'),
    ]);

    await executeAgentRun(deps, 'run-1');

    expect(provider.requests).toHaveLength(3);
    expect(repo.markFailed.mock.calls[0]![1].error).toMatch(/model call budget exhausted/i);
    expect(repo.markFailed.mock.calls[0]![1].modelCalls).toBe(3);
  });
});

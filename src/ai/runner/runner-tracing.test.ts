import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunSpan, RunSpanData } from '../../integrations/tracing/index.js';

const startRunTrace = vi.fn();

// O runner depende só da nossa interface (startSpan/span/end/fail), nunca dos
// tipos do Langfuse — por isso o seam de teste certo é aqui, não uma trace real.
vi.mock('../../integrations/tracing/index.js', () => ({
  startRunTrace: (...args: unknown[]) => startRunTrace(...args),
}));

import { executeAgentRun } from './runner.js';
import { harness, RUN } from './runner.harness.js';
import type { AiCompletion } from '../providers/provider.js';

const toolCall = (): AiCompletion => ({
  text: null,
  toolCalls: [{ id: 'call_1', name: 'get_business_context', args: { sections: ['companyProfile'] } }],
  usage: { inputTokens: 50, outputTokens: 10, cachedInputTokens: 0 },
  finishReason: 'tool_calls',
});

const finalAnswer = (): AiCompletion => ({
  text: JSON.stringify({ summary: 'Acme sells X', risks: ['a', 'b', 'c'], confidence: 'HIGH' }),
  toolCalls: [],
  usage: { inputTokens: 120, outputTokens: 30, cachedInputTokens: 20 },
  finishReason: 'stop',
});

/** Trace de teste: registra spans instantâneos e cronometrados (por
 * nome/dados) sem depender do SDK do Langfuse — o mesmo papel do
 * `fakeObservation` em run-trace.test.ts, só que na forma que o runner
 * consome (RunTrace/RunSpan), não na forma que o SDK expõe. */
function fakeTrace() {
  const spans: { name: string; data: RunSpanData | undefined }[] = [];
  let ended: unknown;
  let failed: string | undefined;

  function makeSpan(name: string): RunSpan {
    return {
      child: (childName: string) => makeSpan(childName),
      update: () => {},
      end: (data?: RunSpanData) => {
        spans.push({ name, data });
      },
    };
  }

  return {
    trace: {
      startSpan: (name: string) => makeSpan(name),
      span: (name: string, data?: RunSpanData) => spans.push({ name, data }),
      end: (output: unknown) => {
        ended = output;
      },
      fail: (error: string) => {
        failed = error;
      },
    },
    spans,
    getEnded: () => ended,
    getFailed: () => failed,
  };
}

const throwingTrace = {
  startSpan: vi.fn(() => {
    throw new Error('tracing outage');
  }),
  span: vi.fn(() => {
    throw new Error('tracing outage');
  }),
  end: vi.fn(() => {
    throw new Error('tracing outage');
  }),
  fail: vi.fn(() => {
    throw new Error('tracing outage');
  }),
};

describe('executeAgentRun — tracing', () => {
  beforeEach(() => startRunTrace.mockReset());

  it('starts one trace named by taskType, carrying agentRunId/workspaceId/tags/model', async () => {
    startRunTrace.mockResolvedValue(fakeTrace().trace);
    const { deps } = harness([finalAnswer()]);

    await executeAgentRun(deps, 'run-1');

    expect(startRunTrace).toHaveBeenCalledTimes(1);
    const [name, identity, metadata] = startRunTrace.mock.calls[0]!;
    expect(name).toBe(RUN.taskType);
    expect(identity).toMatchObject({ agentRunId: 'run-1', workspaceId: RUN.workspaceId, userId: RUN.requestedBy });
    expect((identity as { tags: string[] }).tags).toContain('TIER1');
    expect(metadata).toMatchObject({ model: expect.any(String) });
  });

  it('a tracing client that throws on every call does not fail a successful run', async () => {
    startRunTrace.mockResolvedValue(throwingTrace);
    const { deps, repo } = harness([toolCall(), finalAnswer()]);

    await executeAgentRun(deps, 'run-1');

    expect(repo.markCompleted).toHaveBeenCalled();
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('a tracing client that throws on every call does not break a run that fails', async () => {
    startRunTrace.mockResolvedValue(throwingTrace);
    const { deps, repo } = harness([finalAnswer()]);
    repo.findById.mockResolvedValue({ ...RUN, taskType: 'ghost' });

    await executeAgentRun(deps, 'run-1');

    expect(repo.markFailed).toHaveBeenCalled();
  });

  it('records a timed span per tool call and per model call, then ends the trace on completion', async () => {
    const fake = fakeTrace();
    startRunTrace.mockResolvedValue(fake.trace);

    const { deps, repo } = harness([toolCall(), finalAnswer()]);
    await executeAgentRun(deps, 'run-1');

    expect(repo.markCompleted).toHaveBeenCalled();
    expect(fake.spans.filter((s) => s.name === 'tool-call')).toHaveLength(1);
    expect(fake.spans.filter((s) => s.name === 'model-call')).toHaveLength(2);
    expect(fake.getEnded()).toBeDefined();
  });

  it('records a guardrail-rejection span with the feedback fed back to the model', async () => {
    const fake = fakeTrace();
    startRunTrace.mockResolvedValue(fake.trace);

    const invalidJson: AiCompletion = {
      text: 'not json',
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
      finishReason: 'stop',
    };
    const { deps } = harness([invalidJson, finalAnswer()]);

    await executeAgentRun(deps, 'run-1');

    const rejection = fake.spans.find((s) => s.name === 'guardrail-rejection');
    expect(rejection).toBeDefined();
    expect(typeof rejection?.data?.output).toBe('string');
  });

  it('records an authorize span and, on tier escalation, an escalate-tier span', async () => {
    const fake = fakeTrace();
    startRunTrace.mockResolvedValue(fake.trace);

    const invalidJson: AiCompletion = {
      text: 'not json',
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
      finishReason: 'stop',
    };
    const invalidJson2: AiCompletion = { ...invalidJson };
    const { deps } = harness([invalidJson, invalidJson2, finalAnswer()]);

    await executeAgentRun(deps, 'run-1');

    expect(fake.spans.find((s) => s.name === 'authorize')).toBeDefined();
    expect(fake.spans.find((s) => s.name === 'escalate-tier')).toBeDefined();
  });
});

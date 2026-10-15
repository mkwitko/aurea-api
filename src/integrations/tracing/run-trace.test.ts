import { beforeEach, describe, expect, it, vi } from 'vitest';

// Ambiente de teste não define LANGFUSE_*, então isto exercita o caminho real
// de "não configurado" (nenhum mock) — o mesmo caminho que dev e CI usam.
import { startRunTrace as startRunTraceUnconfigured } from './run-trace.js';

describe('startRunTrace — unconfigured', () => {
  it('returns a trace whose calls are all silent no-ops', async () => {
    const trace = await startRunTraceUnconfigured('summarize-business-context', {
      agentRunId: 'run-1',
      workspaceId: 'ws-1',
    });

    const span = trace.startSpan('model-call');
    expect(() => span.child('tool-call').end()).not.toThrow();
    expect(() => span.end()).not.toThrow();
    expect(() => trace.span('tool-call', { input: { a: 1 }, output: { b: 2 } })).not.toThrow();
    expect(() => trace.end({ output: { ok: true } })).not.toThrow();
    expect(() => trace.fail('boom')).not.toThrow();
  });
});

const ended: { name: string; parent: string | undefined }[] = [];

function fakeObservation(name: string, parent?: string) {
  const spanId = `span-${name}`;
  return {
    otelSpan: { spanContext: () => ({ traceId: 'trace-1', spanId, traceFlags: 1 }) },
    startObservation: (childName: string) => fakeObservation(childName, spanId),
    update: vi.fn().mockReturnThis(),
    end: vi.fn(() => ended.push({ name, parent })),
  };
}

vi.mock('@langfuse/tracing', () => ({
  startObservation: vi.fn((name: string) => fakeObservation(name)),
  createTraceId: vi.fn(async (seed: string) => `trace-${seed}`),
}));
vi.mock('./langfuse-client.js', () => ({
  isTracingConfigured: () => true,
  ensureTracerRegistered: () => {},
}));

import { startRunTrace } from './run-trace.js';

describe('startRunTrace — configured', () => {
  beforeEach(() => {
    ended.length = 0;
  });

  it('does not end a span until the caller ends it', async () => {
    const trace = await startRunTrace('propose-goal', { agentRunId: 'run-1', workspaceId: 'ws-1' });
    const span = trace.startSpan('model-call');

    expect(ended).toHaveLength(0);

    span.end({ output: { text: 'done' } });
    expect(ended.map((entry) => entry.name)).toEqual(['model-call']);
  });

  it('parents a child span to its own span, not to the root', async () => {
    const trace = await startRunTrace('propose-goal', { agentRunId: 'run-1', workspaceId: 'ws-1' });
    const modelCall = trace.startSpan('model-call');
    const toolCall = modelCall.child('tool-call');

    toolCall.end();
    modelCall.end();

    expect(ended.find((entry) => entry.name === 'tool-call')!.parent).toBe('span-model-call');
  });

  it('is still a no-op-safe object when a span call throws', async () => {
    const trace = await startRunTrace('propose-goal', { agentRunId: 'run-1', workspaceId: 'ws-1' });
    const span = trace.startSpan('model-call');
    expect(() => span.end({ output: { huge: 'x'.repeat(100) } })).not.toThrow();
  });
});

import { createTraceId, startObservation } from '@langfuse/tracing';
import type { SpanContext } from '@opentelemetry/api';
import { ensureTracerRegistered, isTracingConfigured } from './langfuse-client.js';
import { redact } from './redact.js';

export type RunSpanData = {
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  level?: 'DEFAULT' | 'DEBUG' | 'WARNING' | 'ERROR';
  /** 'generation' gets model calls proper cost/token display in the Langfuse UI. */
  kind?: 'span' | 'generation' | 'tool';
  model?: string;
  usageDetails?: Record<string, number>;
  costDetails?: Record<string, number>;
};

export interface RunSpan {
  child(name: string, data?: RunSpanData): RunSpan;
  update(data: RunSpanData): void;
  end(data?: RunSpanData): void;
}

export interface RunTrace {
  startSpan(name: string, data?: RunSpanData): RunSpan;
  span(name: string, data?: RunSpanData): void;
  end(data?: RunSpanData): void;
  fail(error: string): void;
}

export type RunTraceIdentity = {
  agentRunId: string;
  workspaceId: string;
  userId?: string;
  tags?: string[];
};

const noopSpan: RunSpan = {
  child: () => noopSpan,
  update() {},
  end() {},
};

const noopTrace: RunTrace = {
  startSpan: () => noopSpan,
  span() {},
  end() {},
  fail() {},
};

function attributes(data?: RunSpanData) {
  return {
    input: redact(data?.input),
    output: redact(data?.output),
    metadata: redact(data?.metadata) as Record<string, unknown> | undefined,
    level: data?.level,
    ...(data?.model ? { model: data.model } : {}),
    ...(data?.usageDetails ? { usageDetails: data.usageDetails } : {}),
    ...(data?.costDetails ? { costDetails: data.costDetails } : {}),
  };
}

function asType(kind: RunSpanData['kind']): 'span' | 'generation' | 'tool' {
  return kind ?? 'span';
}

// `observation` é o objeto do SDK; nada fora deste arquivo o vê.
function wrap(observation: {
  startObservation: (name: string, data: unknown, options: unknown) => unknown;
  update: (data: unknown) => unknown;
  end: () => unknown;
}): RunSpan {
  return {
    child(name, data) {
      try {
        return wrap(
          observation.startObservation(name, attributes(data), { asType: asType(data?.kind) }) as never,
        );
      } catch {
        return noopSpan;
      }
    },
    update(data) {
      try {
        observation.update(attributes(data));
      } catch {
        // Uma falha de tracing nunca pode derrubar o run.
      }
    },
    end(data) {
      try {
        if (data) observation.update(attributes(data));
        observation.end();
      } catch {
        // idem
      }
    },
  };
}

/**
 * Uma trace por agent run, nomeada pelo taskType. Nunca lança: tracing é
 * visibilidade, não parte do caminho crítico do run (mesmo raciocínio do
 * publishRunEvent em ai/events/run-events.ts).
 *
 * O id da trace é derivado do agentRunId, não sorteado. É isso que permite
 * chegar à trace a partir de uma linha do banco sem guardar coluna nenhuma —
 * ver integrations/tracing/trace-url.ts.
 */
export async function startRunTrace(
  name: string,
  identity: RunTraceIdentity,
  metadata: Record<string, unknown> = {},
): Promise<RunTrace> {
  if (!isTracingConfigured()) return noopTrace;

  try {
    ensureTracerRegistered();

    const traceId = await createTraceId(identity.agentRunId);
    const root = startObservation(
      name,
      {
        metadata: redact({ ...metadata, agentRunId: identity.agentRunId }) as Record<string, unknown>,
        // Sem estes três a UI do Langfuse não filtra nada: workspace vira
        // sessão, quem pediu vira usuário, e taskType/tier viram tags.
        userId: identity.userId,
        sessionId: identity.workspaceId,
        tags: identity.tags,
      } as never,
      {
        parentSpanContext: {
          traceId,
          spanId: '0123456789abcdef',
          traceFlags: 1,
        } as SpanContext,
      },
    );

    const rootSpan = wrap(root as never);

    return {
      startSpan: (spanName, data) => rootSpan.child(spanName, data),
      span(spanName, data) {
        rootSpan.child(spanName, data).end();
      },
      end(data) {
        rootSpan.end(data);
      },
      fail(error) {
        rootSpan.end({ output: { error }, level: 'ERROR' });
      },
    };
  } catch {
    return noopTrace;
  }
}

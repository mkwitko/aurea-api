import OpenAI from 'openai';
import { z } from 'zod';
import { env } from '../../config/env.js';
import {
  ProviderError,
  type AiCompletion,
  type AiCompletionRequest,
  type AiMessage,
  type AiProvider,
  type AiToolCall,
} from './provider.js';

export type ChatCompletionsClient = {
  chat: {
    completions: {
      create(body: unknown, options: { signal: AbortSignal }): Promise<unknown>;
    };
  };
};

// A resposta do SDK entra como `unknown` e é estreitada aqui. Sem `as`.
const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullish(),
        message: z.object({
          content: z.string().nullish(),
          tool_calls: z
            .array(
              z.object({
                id: z.string(),
                function: z.object({ name: z.string(), arguments: z.string() }),
              }),
            )
            .nullish(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      // .nullish() (not .optional()): DeepSeek may send this key as an explicit
      // `null` instead of omitting it. Its absence is harmless — the field only
      // exists to bill cached input at a fraction of the fresh rate (Task 4) — so
      // neither shape should fail the whole response. `prompt_tokens` and
      // `completion_tokens` stay strict `z.number()` on purpose: those drive
      // billing directly, and a vendor sending null/missing token counts is a
      // genuine anomaly worth surfacing as a `ProviderError` rather than silently
      // costing the run at zero.
      prompt_cache_hit_tokens: z.number().nullish(),
    })
    .nullish(),
});

function toFinishReason(raw: string | null | undefined): AiCompletion['finishReason'] {
  if (raw === 'stop' || raw === 'tool_calls' || raw === 'length') return raw;
  return 'other';
}

function toWireMessage(message: AiMessage): unknown {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  }
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: message.content,
      ...(message.toolCalls?.length
        ? {
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              type: 'function',
              function: { name: call.name, arguments: JSON.stringify(call.args) },
            })),
          }
        : {}),
    };
  }
  return { role: message.role, content: message.content };
}

function toToolCall(raw: { id: string; function: { name: string; arguments: string } }): AiToolCall {
  try {
    return { id: raw.id, name: raw.function.name, args: JSON.parse(raw.function.arguments) };
  } catch {
    // Argumento inválido não derruba o run: vira marcador, falha na validação
    // do argsSchema e o erro volta para o modelo como resultado da tool.
    return { id: raw.id, name: raw.function.name, args: { __unparseableArguments: raw.function.arguments } };
  }
}

function sanitize(error: unknown): ProviderError {
  const status =
    typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
      ? error.status
      : undefined;
  const message = error instanceof Error ? error.message : 'provider request failed';
  // Só status e mensagem atravessam: o objeto do SDK carrega headers com a chave.
  return new ProviderError(message, status);
}

export function createOpenAiCompatibleProvider(deps: {
  name: string;
  client: ChatCompletionsClient;
}): AiProvider {
  return {
    name: deps.name,
    async complete(req: AiCompletionRequest): Promise<AiCompletion> {
      let raw: unknown;
      try {
        raw = await deps.client.chat.completions.create(
          {
            model: req.modelId,
            messages: req.messages.map(toWireMessage),
            max_tokens: req.maxTokens,
            ...(req.jsonMode ? { response_format: { type: 'json_object' } } : {}),
            ...(req.tools?.length
              ? {
                  tools: req.tools.map((tool) => ({
                    type: 'function',
                    function: {
                      name: tool.name,
                      description: tool.description,
                      parameters: tool.parameters,
                    },
                  })),
                }
              : {}),
          },
          { signal: req.signal },
        );
      } catch (error) {
        throw sanitize(error);
      }

      const parsed = responseSchema.safeParse(raw);
      if (!parsed.success) {
        // Log da resposta crua quando o schema do provider não encaixa —
        // tipicamente reasoning_content de modelo de raciocínio que o schema
        // não está capturando.
        console.error('[provider] unexpected response shape', JSON.stringify(raw).slice(0, 2000));
        throw new ProviderError('unexpected provider response shape');
      }

      const choice = parsed.data.choices[0]!;
      const usage = parsed.data.usage;

      // Modelos de raciocínio (deepseek-v4-pro) podem devolver reasoning_content
      // em vez de content. Se content vier null/vazio mas houver reasoning_content,
      // usamos o reasoning_content como fallback — o guardrail vai rejeitar se não
      // for JSON, e o modelo se corrige.
      const rawMsg = choice.message as Record<string, unknown>;
      const content = typeof rawMsg.content === 'string' && rawMsg.content.trim()
        ? rawMsg.content
        : typeof rawMsg.reasoning_content === 'string'
          ? rawMsg.reasoning_content
          : null;

      if (content !== choice.message.content) {
        console.error(
          '[provider] content was null/empty, fell back to reasoning_content',
          { contentLength: content?.length ?? 0, reasoningLength: (rawMsg.reasoning_content as string)?.length ?? 0 },
        );
      }

      return {
        text: content,
        toolCalls: (choice.message.tool_calls ?? []).map(toToolCall),
        usage: {
          inputTokens: usage?.prompt_tokens ?? 0,
          outputTokens: usage?.completion_tokens ?? 0,
          cachedInputTokens: usage?.prompt_cache_hit_tokens ?? 0,
        },
        finishReason: toFinishReason(choice.finish_reason),
      };
    },
  };
}

export function createDeepSeekProvider(apiKey: string): AiProvider {
  const client = new OpenAI({ apiKey, baseURL: env.AI_PROVIDER_BASE_URL });
  return createOpenAiCompatibleProvider({ name: 'deepseek', client });
}

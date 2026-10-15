import { describe, expect, it, vi } from 'vitest';
import { createOpenAiCompatibleProvider } from './openai-compatible.js';
import { ProviderError } from './provider.js';

function clientReturning(payload: unknown) {
  const create = vi.fn().mockResolvedValue(payload);
  return { client: { chat: { completions: { create } } }, create };
}

const req = {
  modelId: 'deepseek-chat',
  messages: [{ role: 'user' as const, content: 'oi' }],
  jsonMode: true,
  maxTokens: 512,
  signal: new AbortController().signal,
};

describe('openai-compatible provider', () => {
  it('maps a plain text answer and its cache-aware usage', async () => {
    const { client } = clientReturning({
      choices: [{ finish_reason: 'stop', message: { content: '{"a":1}', tool_calls: null } }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        prompt_cache_hit_tokens: 40,
        prompt_cache_miss_tokens: 60,
      },
    });
    const provider = createOpenAiCompatibleProvider({ name: 'deepseek', client });

    const out = await provider.complete(req);

    expect(out.text).toBe('{"a":1}');
    expect(out.finishReason).toBe('stop');
    expect(out.usage).toEqual({ inputTokens: 100, outputTokens: 20, cachedInputTokens: 40 });
  });

  it('defaults cachedInputTokens to zero when the field is absent', async () => {
    const { client } = clientReturning({
      choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
      usage: { prompt_tokens: 5, completion_tokens: 1 },
    });
    const provider = createOpenAiCompatibleProvider({ name: 'x', client });

    expect((await provider.complete(req)).usage.cachedInputTokens).toBe(0);
  });

  it('defaults cachedInputTokens to zero when the field is explicitly null', async () => {
    const { client } = clientReturning({
      choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
      usage: { prompt_tokens: 5, completion_tokens: 1, prompt_cache_hit_tokens: null },
    });
    const provider = createOpenAiCompatibleProvider({ name: 'x', client });

    const out = await provider.complete(req);

    expect(out.usage).toEqual({ inputTokens: 5, outputTokens: 1, cachedInputTokens: 0 });
  });

  it('parses tool calls and their JSON arguments', async () => {
    const { client } = clientReturning({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: 'get_business_context', arguments: '{"sections":["company"]}' } },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const provider = createOpenAiCompatibleProvider({ name: 'x', client });

    const out = await provider.complete(req);

    expect(out.finishReason).toBe('tool_calls');
    expect(out.toolCalls).toEqual([
      { id: 'call_1', name: 'get_business_context', args: { sections: ['company'] } },
    ]);
  });

  it('keeps unparseable tool arguments as a marker instead of throwing', async () => {
    const { client } = clientReturning({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [{ id: 'c1', type: 'function', function: { name: 't', arguments: '{not json' } }],
          },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const provider = createOpenAiCompatibleProvider({ name: 'x', client });

    const [call] = (await provider.complete(req)).toolCalls;

    expect(call!.args).toEqual({ __unparseableArguments: '{not json' });
  });

  it('sends response_format and tools when asked', async () => {
    const { client, create } = clientReturning({
      choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const provider = createOpenAiCompatibleProvider({ name: 'x', client });

    await provider.complete({
      ...req,
      tools: [{ name: 't', description: 'd', parameters: { type: 'object' } }],
    });

    const body = create.mock.calls[0]![0];
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.tools).toEqual([
      { type: 'function', function: { name: 't', description: 'd', parameters: { type: 'object' } } },
    ]);
  });

  it('wraps SDK failures in ProviderError without leaking the raw error object', async () => {
    const create = vi.fn().mockRejectedValue(
      Object.assign(new Error('401 Unauthorized'), { status: 401, headers: { authorization: 'Bearer sk-secret' } }),
    );
    const provider = createOpenAiCompatibleProvider({
      name: 'x',
      client: { chat: { completions: { create } } },
    });

    const err = await provider.complete(req).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).status).toBe(401);
    expect(JSON.stringify(err)).not.toContain('sk-secret');
  });

  it('rejects a malformed response shape', async () => {
    const { client } = clientReturning({ nope: true });
    const provider = createOpenAiCompatibleProvider({ name: 'x', client });

    await expect(provider.complete(req)).rejects.toBeInstanceOf(ProviderError);
  });
});

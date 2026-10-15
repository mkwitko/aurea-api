import { describe, expect, it } from 'vitest';
import { createFakeProvider } from './fake.js';
import type { AiCompletion } from './provider.js';

const answer = (text: string): AiCompletion => ({
  text,
  toolCalls: [],
  usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
  finishReason: 'stop',
});

describe('fake provider', () => {
  it('returns scripted completions in order', async () => {
    const provider = createFakeProvider([answer('first'), answer('second')]);
    const req = {
      modelId: 'm',
      messages: [{ role: 'user' as const, content: 'hi' }],
      jsonMode: true,
      maxTokens: 100,
      signal: new AbortController().signal,
    };

    expect((await provider.complete(req)).text).toBe('first');
    expect((await provider.complete(req)).text).toBe('second');
  });

  it('records every request it received', async () => {
    const provider = createFakeProvider([answer('x')]);
    await provider.complete({
      modelId: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      jsonMode: true,
      maxTokens: 100,
      signal: new AbortController().signal,
    });

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]!.modelId).toBe('m');
  });

  it('throws when the script runs out, instead of looping silently', async () => {
    const provider = createFakeProvider([]);
    await expect(
      provider.complete({
        modelId: 'm',
        messages: [],
        jsonMode: true,
        maxTokens: 10,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/script exhausted/i);
  });
});

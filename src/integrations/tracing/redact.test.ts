import { describe, expect, it } from 'vitest';
import { redact } from './redact.js';

describe('redact', () => {
  it('truncates strings past the cap', () => {
    const long = 'x'.repeat(50_000);
    const result = redact(long) as string;
    expect(result.length).toBeLessThan(long.length);
    expect(result).toContain('truncated');
  });

  it('leaves short strings and primitives untouched', () => {
    expect(redact('hello')).toBe('hello');
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
  });

  it('redacts sensitive keys instead of sending their value', () => {
    const out = redact({
      apiKey: 'sk-live-secret',
      Authorization: 'Bearer abc',
      password: 'hunter2',
      // SealedSecret shape from billing/crypto.ts
      ciphertext: Buffer.from('a'),
      iv: Buffer.from('b'),
      authTag: Buffer.from('c'),
      businessName: 'Acme',
    }) as Record<string, unknown>;

    expect(out.apiKey).toBe('[redacted]');
    expect(out.Authorization).toBe('[redacted]');
    expect(out.password).toBe('[redacted]');
    expect(out.ciphertext).toBe('[redacted]');
    expect(out.iv).toBe('[redacted]');
    expect(out.authTag).toBe('[redacted]');
    expect(out.businessName).toBe('Acme');
  });

  it('recurses into nested objects and arrays', () => {
    const out = redact({
      messages: [{ role: 'tool', content: { auth: { apiKey: 'k' }, ok: true } }],
    }) as { messages: [{ content: { auth: { apiKey: string }; ok: boolean } }] };

    expect(out.messages[0].content.auth.apiKey).toBe('[redacted]');
    expect(out.messages[0].content.ok).toBe(true);
  });

  it('caps array length so one giant tool result cannot flood a trace', () => {
    const out = redact(Array.from({ length: 150 }, (_, i) => i)) as unknown[];
    expect(out.length).toBe(101); // 100 items + one "…N more" marker
    expect(out[100]).toContain('more items');
  });

  it('keeps a full system prompt intact', () => {
    const prompt = 'You are a growth strategist for AUREA. '.repeat(300); // ~11.7k chars
    expect(redact(prompt)).toBe(prompt);
  });

  it('still truncates something absurd, and says how much it cut', () => {
    const huge = 'x'.repeat(60_000);
    const result = redact(huge) as string;
    expect(result.length).toBeLessThan(huge.length);
    expect(result).toContain('truncated');
  });

  it('still redacts a long secret rather than letting the higher cap through', () => {
    expect(redact({ apiKey: 'sk-'.padEnd(5000, 'a') })).toEqual({ apiKey: '[redacted]' });
  });
});

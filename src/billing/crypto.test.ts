import { describe, expect, it } from 'vitest';
import { last4, open, seal } from './crypto.js';

const KEY = 'sk-live-abcdefghijklmnop9876';

describe('seal/open', () => {
  it('round-trips a secret', () => {
    expect(open(seal(KEY))).toBe(KEY);
  });

  it('never stores the plaintext', () => {
    const sealed = seal(KEY);
    expect(sealed.ciphertext.toString('utf8')).not.toContain('sk-live');
    expect(sealed.ciphertext.toString('hex')).not.toContain(Buffer.from(KEY).toString('hex'));
  });

  it('uses a fresh iv per seal', () => {
    expect(seal(KEY).iv.toString('hex')).not.toBe(seal(KEY).iv.toString('hex'));
  });

  it('refuses a tampered ciphertext', () => {
    const sealed = seal(KEY);
    sealed.ciphertext[0] = sealed.ciphertext[0]! ^ 0xff;
    expect(() => open(sealed)).toThrow();
  });

  it('refuses a tampered authTag', () => {
    const sealed = seal(KEY);
    sealed.authTag[0] = sealed.authTag[0]! ^ 0xff;
    expect(() => open(sealed)).toThrow();
  });

  it('exposes only the last four characters', () => {
    expect(last4(KEY)).toBe('9876');
  });
});

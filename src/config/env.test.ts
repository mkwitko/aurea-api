import { describe, expect, it } from 'vitest';
import { envSchema } from './env.js';

const BASE = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a-secret-with-16-chars',
};

describe('envSchema', () => {
  it('applies AI defaults when the vars are absent', () => {
    const parsed = envSchema.parse(BASE);
    expect(parsed.AI_PROVIDER_BASE_URL).toBe('https://api.deepseek.com');
    expect(parsed.AI_WORKER_ENABLED).toBe(true);
    expect(parsed.AI_WORKER_CONCURRENCY).toBe(2);
    expect(parsed.AI_CALL_TIMEOUT_MS).toBe(60_000);
    expect(parsed.AI_RUN_TIMEOUT_MS).toBe(180_000);
  });

  it('coerces AI_WORKER_ENABLED=false from the string', () => {
    const parsed = envSchema.parse({ ...BASE, AI_WORKER_ENABLED: 'false' });
    expect(parsed.AI_WORKER_ENABLED).toBe(false);
  });

  it('coerces numeric env vars from strings', () => {
    const parsed = envSchema.parse({ ...BASE, AI_WORKER_CONCURRENCY: '5' });
    expect(parsed.AI_WORKER_CONCURRENCY).toBe(5);
  });

  it('defaults REDIS_URL to the local compose port', () => {
    expect(envSchema.parse(BASE).REDIS_URL).toBe('redis://localhost:6380');
  });

  it('normalises blank AI_MODEL_TIER1 to undefined', () => {
    const parsed = envSchema.parse({ ...BASE, AI_MODEL_TIER1: '' });
    expect(parsed.AI_MODEL_TIER1).toBeUndefined();
  });

  it('normalises whitespace-only AI_MODEL_TIER1 to undefined', () => {
    const parsed = envSchema.parse({ ...BASE, AI_MODEL_TIER1: '  ' });
    expect(parsed.AI_MODEL_TIER1).toBeUndefined();
  });

  it('preserves non-blank AI_MODEL_TIER1', () => {
    const parsed = envSchema.parse({ ...BASE, AI_MODEL_TIER1: 'custom-model' });
    expect(parsed.AI_MODEL_TIER1).toBe('custom-model');
  });

  it('normalises blank AI_PROVIDER_API_KEY to undefined', () => {
    const parsed = envSchema.parse({ ...BASE, AI_PROVIDER_API_KEY: '' });
    expect(parsed.AI_PROVIDER_API_KEY).toBeUndefined();
  });

  describe('stripe configuration', () => {
    it('treats a blank stripe key as absent', () => {
      const parsed = envSchema.parse({ ...BASE, STRIPE_SECRET_KEY: '  ' });
      expect(parsed.STRIPE_SECRET_KEY).toBeUndefined();
    });

    it('defaults APP_URL to the local frontend', () => {
      expect(envSchema.parse(BASE).APP_URL).toBe('http://localhost:5173');
    });

    it('rejects an APP_URL that is not a url', () => {
      expect(() => envSchema.parse({ ...BASE, APP_URL: 'localhost:5173' })).toThrow();
    });

    // Fail closed, como já se faz com AI_KEY_ENCRYPTION_KEY: um deploy que
    // esquece APP_URL bootava limpo e redirecionava quem acabou de pagar para o
    // localhost de alguém.
    it('refuses the localhost default in production', () => {
      expect(() => envSchema.parse({ ...BASE, NODE_ENV: 'production' })).toThrow(/APP_URL/);
    });

    it('refuses a loopback APP_URL in production', () => {
      expect(() => envSchema.parse({ ...BASE, NODE_ENV: 'production', APP_URL: 'http://127.0.0.1:5173' })).toThrow(
        /APP_URL/,
      );
    });

    it('accepts a real APP_URL in production', () => {
      const parsed = envSchema.parse({ ...BASE, NODE_ENV: 'production', APP_URL: 'https://app.aurea.com' });
      expect(parsed.APP_URL).toBe('https://app.aurea.com');
    });

    it('keeps allowing localhost outside production', () => {
      expect(envSchema.parse({ ...BASE, NODE_ENV: 'development' }).APP_URL).toBe('http://localhost:5173');
    });
  });
});

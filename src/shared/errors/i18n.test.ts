import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { InsufficientCreditsError, UnknownCreditPackError, WorkspaceLimitReachedError } from '../../lib/errors.js';

const dir = new URL('./i18n/', import.meta.url).pathname;

function bundle(file: string): Record<string, string> {
  return JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, string>;
}

describe('error locales', () => {
  it('has the same keys in every locale', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    const reference = Object.keys(bundle(files[0]!)).sort();

    for (const file of files) {
      expect({ file, keys: Object.keys(bundle(file)).sort() }).toEqual({ file, keys: reference });
    }
  });

  it('interpolates the credit numbers the UI needs', () => {
    const error = new InsufficientCreditsError({ required: 9, available: 2 });
    expect(error.message).toContain('9');
    expect(error.message).toContain('2');
  });

  describe('billing errors', () => {
    it('tells the user which plan limit they hit', () => {
      const error = new WorkspaceLimitReachedError({ current: 1, max: 1 });
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe('AUR-T0017');
      expect(error.message).toContain('1');
    });

    it('names the pack it does not know', () => {
      const error = new UnknownCreditPackError({ packId: 'HUGE' });
      expect(error.statusCode).toBe(400);
      expect(error.message).toContain('HUGE');
    });
  });
});

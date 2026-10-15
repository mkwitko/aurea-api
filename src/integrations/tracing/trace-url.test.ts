import { describe, expect, it } from 'vitest';
import { traceUrlFor } from './trace-url.js';

describe('traceUrlFor', () => {
  it('returns null when tracing is not configured', async () => {
    // O ambiente de teste não define LANGFUSE_* — mesmo caminho de dev e CI.
    expect(await traceUrlFor('run-1')).toBeNull();
  });

  it('is deterministic for a given run id', async () => {
    expect(await traceUrlFor('run-1')).toEqual(await traceUrlFor('run-1'));
  });
});

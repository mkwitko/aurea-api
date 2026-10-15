import { describe, expect, it } from 'vitest';
import { getModelForTier, nextTier, resolveTierForTask, UnknownTaskTypeError } from './router.js';
import { MODEL_CATALOG } from './catalog.js';

describe('model router', () => {
  it('maps the canary task to tier 1', () => {
    expect(resolveTierForTask('summarize-business-context')).toBe('TIER1');
  });

  it('throws on an unknown task type', () => {
    expect(() => resolveTierForTask('does-not-exist')).toThrow(UnknownTaskTypeError);
  });

  it('escalates one tier and then stops', () => {
    expect(nextTier('TIER1')).toBe('TIER2');
    expect(nextTier('TIER2')).toBeNull();
  });

  it('puts the cheaper model on tier 1 and the more capable one on tier 2', () => {
    expect(getModelForTier('TIER1').modelId).toBe('deepseek-v4-flash');
    expect(getModelForTier('TIER2').modelId).toBe('deepseek-v4-pro');
    expect(getModelForTier('TIER1').pricePerMTokIn).toBeLessThan(
      getModelForTier('TIER2').pricePerMTokIn,
    );
  });

  it('returns a model with tool and json support for every tier', () => {
    for (const tier of ['TIER1', 'TIER2'] as const) {
      const entry = getModelForTier(tier);
      expect(entry.capabilities.tools).toBe(true);
      expect(entry.capabilities.jsonMode).toBe(true);
    }
  });

  it('prices every catalog entry above zero, cached input below fresh input', () => {
    for (const entry of Object.values(MODEL_CATALOG)) {
      expect(entry.pricePerMTokIn).toBeGreaterThan(0);
      expect(entry.pricePerMTokCachedIn).toBeGreaterThan(0);
      expect(entry.pricePerMTokOut).toBeGreaterThan(0);
      expect(entry.pricePerMTokCachedIn).toBeLessThan(entry.pricePerMTokIn);
    }
  });

  it('marks server-side web search as unavailable on every entry', () => {
    for (const entry of Object.values(MODEL_CATALOG)) {
      expect(entry.capabilities.serverSideWebSearch).toBe(false);
    }
  });
});

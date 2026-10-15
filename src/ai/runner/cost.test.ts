import { describe, expect, it } from 'vitest';
import { addUsage, computeCost, costBreakdown, emptyUsage } from './cost.js';
import { MODEL_CATALOG, type ModelEntry } from '../model-router/catalog.js';

const ENTRY: ModelEntry = {
  provider: 'deepseek',
  modelId: 'test-model',
  pricePerMTokIn: 1,        // USD / 1M
  pricePerMTokCachedIn: 0.1,
  pricePerMTokOut: 2,
  capabilities: { tools: true, jsonMode: true, serverSideWebSearch: false },
};

describe('cost', () => {
  it('bills cached input at the cached price and the rest at full price', () => {
    const cost = computeCost(ENTRY, {
      inputTokens: 1_000_000,
      cachedInputTokens: 400_000,
      outputTokens: 0,
    });
    // 600k a 1 USD/M + 400k a 0.1 USD/M
    expect(cost).toBeCloseTo(0.6 + 0.04, 10);
  });

  it('bills output separately', () => {
    const cost = computeCost(ENTRY, {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 500_000,
    });
    expect(cost).toBeCloseTo(1, 10);
  });

  it('never goes negative when cached exceeds input', () => {
    const cost = computeCost(ENTRY, {
      inputTokens: 100,
      cachedInputTokens: 500,
      outputTokens: 0,
    });
    expect(cost).toBeGreaterThanOrEqual(0);
  });

  it('accumulates usage across calls', () => {
    const total = addUsage(
      addUsage(emptyUsage(), { inputTokens: 10, cachedInputTokens: 4, outputTokens: 2 }),
      { inputTokens: 5, cachedInputTokens: 1, outputTokens: 3 },
    );
    expect(total).toEqual({ inputTokens: 15, cachedInputTokens: 5, outputTokens: 5 });
  });
});

describe('costBreakdown', () => {
  const entry = MODEL_CATALOG.TIER1;
  // cachedInputTokens is a genuine subset of inputTokens (2M total, 1M of it
  // cached) rather than 100% overlap: at 100% overlap, `fresh` clips to 0 and
  // an unclipped `input` component would double-bill the cached tokens'
  // fresh-rate cost on top of their cached-rate cost in Langfuse's cost view
  // — exactly the "inferred cost disagrees with the ledger" failure Task 6
  // exists to prevent.
  const usage = { inputTokens: 2_000_000, cachedInputTokens: 1_000_000, outputTokens: 1_000_000 };

  it('splits the cost the same way the price table does', () => {
    const parts = costBreakdown(entry, usage);
    expect(parts.input).toBeCloseTo(entry.pricePerMTokIn, 10);
    expect(parts.cache_read_input_tokens).toBeCloseTo(entry.pricePerMTokCachedIn, 10);
    expect(parts.output).toBeCloseTo(entry.pricePerMTokOut, 10);
  });

  it('sums to exactly what the ledger charges', () => {
    expect(costBreakdown(entry, usage).total).toBeCloseTo(computeCost(entry, usage), 10);
  });
});

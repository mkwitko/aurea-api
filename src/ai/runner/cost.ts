import type { ModelEntry } from '../model-router/catalog.js';

export type UsageTotals = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

export function emptyUsage(): UsageTotals {
  return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
}

export function addUsage(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}

const PER_MILLION = 1_000_000;

// As chaves (`input`, `output`, `cache_read_input_tokens`, `total`) são as
// chaves convencionais de usage/cost do Langfuse — mantidas ao pé da letra
// para que a UI reconheça o breakdown sem tradução nenhuma da nossa parte.
export type CostBreakdown = {
  input: number;
  output: number;
  cache_read_input_tokens: number;
  total: number;
};

// Uma fórmula, duas visões: `computeCost` é só `costBreakdown(...).total`.
// Duas cópias independentes da mesma aritmética de preço é como a trace e a
// fatura no fim divergem.
export function costBreakdown(entry: ModelEntry, usage: UsageTotals): CostBreakdown {
  const cached = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const fresh = Math.max(usage.inputTokens - cached, 0);

  const input = (fresh * entry.pricePerMTokIn) / PER_MILLION;
  const cache_read_input_tokens = (cached * entry.pricePerMTokCachedIn) / PER_MILLION;
  const output = (usage.outputTokens * entry.pricePerMTokOut) / PER_MILLION;

  return { input, cache_read_input_tokens, output, total: input + cache_read_input_tokens + output };
}

export function computeCost(entry: ModelEntry, usage: UsageTotals): number {
  return costBreakdown(entry, usage).total;
}

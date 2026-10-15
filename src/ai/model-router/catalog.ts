import { env } from '../../config/env.js';

export type Tier = 'TIER1' | 'TIER2';

export type ModelCapabilities = {
  tools: boolean;
  jsonMode: boolean;
  serverSideWebSearch: boolean;
};

export type ModelEntry = {
  provider: 'deepseek';
  modelId: string;
  pricePerMTokIn: number;
  pricePerMTokCachedIn: number;
  pricePerMTokOut: number;
  capabilities: ModelCapabilities;
};

// Preço errado aqui vira margem bruta errada no business-model §6: os valores
// vêm da página oficial de pricing (2026-07-27), não de estimativa.
const CAPABILITIES: ModelCapabilities = {
  tools: true,
  jsonMode: true,
  serverSideWebSearch: false, // DeepSeek não tem web_search/web_fetch server-side
};

export const MODEL_CATALOG: Record<Tier, ModelEntry> = {
  TIER1: {
    provider: 'deepseek',
    modelId: env.AI_MODEL_TIER1 ?? 'deepseek-v4-flash',
    pricePerMTokIn: 0.14,
    pricePerMTokCachedIn: 0.0028,
    pricePerMTokOut: 0.28,
    capabilities: CAPABILITIES,
  },
  TIER2: {
    provider: 'deepseek',
    modelId: env.AI_MODEL_TIER2 ?? 'deepseek-v4-pro',
    pricePerMTokIn: 0.435,
    pricePerMTokCachedIn: 0.003625,
    pricePerMTokOut: 0.87,
    capabilities: CAPABILITIES,
  },
};

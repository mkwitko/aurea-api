import { MODEL_CATALOG, type ModelEntry, type Tier } from './catalog.js';

export class UnknownTaskTypeError extends Error {
  constructor(taskType: string) {
    super(`Unknown task type: ${taskType}`);
    this.name = 'UnknownTaskTypeError';
  }
}

// Ponto de entrada no router por tarefa. Trocar a estratégia de modelo é
// mudar esta tabela, nunca o agente (ai-architecture.md §4).
const TASK_TIER: Record<string, Tier> = {
  'summarize-business-context': 'TIER1',
};

const ORDER: Tier[] = ['TIER1', 'TIER2'];

export function resolveTierForTask(taskType: string): Tier {
  const tier = TASK_TIER[taskType];
  if (!tier) throw new UnknownTaskTypeError(taskType);
  return tier;
}

export function getModelForTier(tier: Tier): ModelEntry {
  return MODEL_CATALOG[tier];
}

export function nextTier(tier: Tier): Tier | null {
  const i = ORDER.indexOf(tier);
  return i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1]! : null;
}

export type { ModelEntry, Tier };

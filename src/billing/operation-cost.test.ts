import { describe, expect, it } from 'vitest';
import { creditCost, operationCatalog, UnknownOperationCostError } from './operation-cost.js';

describe('creditCost', () => {
  it('prices the canary agent at one credit', () => {
    expect(creditCost('summarize-business-context')).toBe(1);
  });

  it('refuses an unknown task type instead of charging zero', () => {
    expect(() => creditCost('ghost')).toThrow(UnknownOperationCostError);
  });

  it('prices a strategy proposal at three credits', () => {
    // A âncora do arquivo é esforço percebido, com ação composta custando a
    // soma das partes: três opções propostas são três pedaços de trabalho
    // reconhecíveis.
    expect(creditCost('propose-strategies')).toBe(3);
  });
});

describe('operationCatalog', () => {
  it('publishes every priced operation', () => {
    expect(operationCatalog()).toContainEqual({ taskType: 'summarize-business-context', credits: 1 });
  });

  it('publishes the strategy proposal in the catalogue', () => {
    // O frontend lê o preço daqui em vez de repetir o número.
    expect(operationCatalog()).toContainEqual({ taskType: 'propose-strategies', credits: 3 });
  });
});

describe('filling-agent prices', () => {
  const EXPECTED: Record<string, number> = {
    'propose-business-profile': 2,
    'propose-business-context': 5,
    'propose-context-section': 1,
    'propose-icp': 1,
    'propose-goal': 1,
    'propose-hypothesis': 1,
    'propose-experiment': 2,
  };

  for (const [taskType, credits] of Object.entries(EXPECTED)) {
    it(`prices ${taskType} at ${credits}`, () => {
      expect(creditCost(taskType)).toBe(credits);
    });
  }

  it('publishes every one of them in the catalog', () => {
    const published = operationCatalog().map((entry) => entry.taskType);
    for (const taskType of Object.keys(EXPECTED)) expect(published).toContain(taskType);
  });

  it('still throws for a task type nobody priced', () => {
    // The guard that makes a forgotten price a loud failure instead of a free
    // run in production.
    expect(() => creditCost('propose-nothing')).toThrow(UnknownOperationCostError);
  });
});

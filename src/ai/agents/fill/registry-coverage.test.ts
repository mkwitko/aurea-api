import { describe, expect, it } from 'vitest';
import { AGENT_REGISTRY } from '../registry.js';
import { creditCost, operationCatalog } from '../../../billing/operation-cost.js';

const FILL_TASKS = [
  'propose-business-profile',
  'propose-business-context',
  'propose-context-section',
  'propose-icp',
  'propose-goal',
  'propose-hypothesis',
  'propose-experiment',
];

describe('the seven filling agents', () => {
  it('are all registered', () => {
    for (const taskType of FILL_TASKS) expect(AGENT_REGISTRY[taskType]).toBeDefined();
  });

  it('all carry a precheck', () => {
    // The hook that refuses before hashInput, before the repository write and
    // before enqueue — therefore before the worker charges anything.
    for (const taskType of FILL_TASKS) expect(AGENT_REGISTRY[taskType]!.precheck).toBeTypeOf('function');
  });

  it('all run on TIER2', () => {
    for (const taskType of FILL_TASKS) expect(AGENT_REGISTRY[taskType]!.tier).toBe('TIER2');
  });

  it('are all priced and published', () => {
    // A registered task type with no price throws UnknownOperationCostError at
    // run time; seven new ones is seven chances to forget.
    const published = operationCatalog().map((entry) => entry.taskType);
    for (const taskType of FILL_TASKS) {
      expect(() => creditCost(taskType)).not.toThrow();
      expect(published).toContain(taskType);
    }
  });

  it('leave nothing in the registry unpriced', () => {
    for (const taskType of Object.keys(AGENT_REGISTRY)) {
      expect(() => creditCost(taskType)).not.toThrow();
    }
  });
});

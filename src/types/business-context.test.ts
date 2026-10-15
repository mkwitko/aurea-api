import { describe, expect, it } from 'vitest';
import {
  calculateCompleteness,
  getIncompleteSections,
  type BusinessContextData,
} from './business-context.js';

/**
 * Zero is a value, not an absence.
 *
 * A pre-revenue founder answers "0" to MRR, "0" to customers, "0" to the
 * growth budget — and those are the honest answers, not skipped questions.
 * Falsy checks over these numeric fields told the founder their section was
 * still empty right after they filled it, which put the guided walk-through in
 * a loop: the section stayed in `incompleteSections`, the page kept offering it
 * as the next thing to do, and the fill agent kept asking the same question.
 */
const zeros: BusinessContextData = {
  currentPerformance: { mrr: 0, totalCustomers: 0, cac: 0, conversionRate: 0 },
  constraints: { monthlyGrowthBudget: 0, teamSize: 0 },
} as BusinessContextData;

describe('getIncompleteSections', () => {
  it('treats a zero answer as answered', () => {
    const incomplete = getIncompleteSections(zeros);
    expect(incomplete).not.toContain('performance');
    expect(incomplete).not.toContain('constraints');
  });

  it('still reports a section nobody touched', () => {
    const incomplete = getIncompleteSections({} as BusinessContextData);
    expect(incomplete).toContain('performance');
    expect(incomplete).toContain('constraints');
  });
});

describe('calculateCompleteness', () => {
  it('counts zero answers towards completeness', () => {
    expect(calculateCompleteness(zeros)).toBeGreaterThan(calculateCompleteness({} as BusinessContextData));
  });

  it('is zero for an untouched context', () => {
    expect(calculateCompleteness({} as BusinessContextData)).toBe(0);
  });
});

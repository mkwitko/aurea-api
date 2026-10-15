import { describe, expect, it } from 'vitest';
import { LearningStatus } from '@prisma/client';
import { assertLearningTransition } from './learnings.domain.js';

/**
 * The table this module enforces. Nothing in `docs/` defines one for Learning,
 * so it is modelled on hypotheses: a human decides, and a decided learning
 * stays decided — archiving is filing it away, not reopening it.
 */
const TRANSITIONS: Record<LearningStatus, LearningStatus[]> = {
  CANDIDATE: ['VALIDATED', 'REJECTED'],
  VALIDATED: ['ARCHIVED'],
  REJECTED: ['ARCHIVED'],
  ARCHIVED: [],
};

describe('assertLearningTransition', () => {
  it('allows exactly the moves in the table', () => {
    for (const [from, targets] of Object.entries(TRANSITIONS)) {
      for (const to of targets) {
        expect(() => assertLearningTransition(from as LearningStatus, to)).not.toThrow();
      }
    }
  });

  it('refuses every move the table does not list', () => {
    const all = Object.keys(TRANSITIONS) as LearningStatus[];
    for (const from of all) {
      for (const to of all) {
        if (TRANSITIONS[from].includes(to)) continue;
        expect(() => assertLearningTransition(from, to)).toThrow();
      }
    }
  });

  it('never lets a decided learning be re-decided', () => {
    // A validated learning that can be rejected later is not knowledge, it is
    // an opinion with a timestamp — and the whole point of validation is that
    // it settles the question.
    expect(() => assertLearningTransition('VALIDATED', 'REJECTED')).toThrow();
    expect(() => assertLearningTransition('REJECTED', 'VALIDATED')).toThrow();
    expect(() => assertLearningTransition('ARCHIVED', 'VALIDATED')).toThrow();
  });
});

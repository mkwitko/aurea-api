import { LearningStatus } from '@prisma/client';
import { BadRequestError } from '../../../lib/errors.js';

/**
 * Nothing in `docs/` defines a transition table for Learning, so this one is
 * modelled on hypotheses: a human decides, and a decided learning stays
 * decided. Archiving files it away rather than reopening it, which is why both
 * decided states lead there and nothing leads back.
 */
const TRANSITIONS: Record<LearningStatus, LearningStatus[]> = {
  CANDIDATE: [LearningStatus.VALIDATED, LearningStatus.REJECTED],
  VALIDATED: [LearningStatus.ARCHIVED],
  REJECTED: [LearningStatus.ARCHIVED],
  ARCHIVED: [],
};

export function assertLearningTransition(from: LearningStatus, to: LearningStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new BadRequestError(`Cannot move learning from ${from} to ${to}`);
  }
}

import { HypothesisStatus } from '@prisma/client';
import { BadRequestError } from '../../../lib/errors.js';

const TRANSITIONS: Record<HypothesisStatus, HypothesisStatus[]> = {
  DRAFT: [HypothesisStatus.PROPOSED, HypothesisStatus.REJECTED],
  PROPOSED: [HypothesisStatus.TESTED, HypothesisStatus.REJECTED],
  TESTED: [HypothesisStatus.VALIDATED, HypothesisStatus.REJECTED],
  VALIDATED: [],
  REJECTED: [],
};

export function assertHypothesisTransition(from: HypothesisStatus, to: HypothesisStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new BadRequestError(`Cannot move hypothesis from ${from} to ${to}`);
  }
}

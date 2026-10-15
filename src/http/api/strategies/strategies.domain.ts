import { StrategyStatus } from '@prisma/client';
import { BadRequestError } from '../../../lib/errors.js';

const TRANSITIONS: Record<StrategyStatus, StrategyStatus[]> = {
  DRAFT: [StrategyStatus.PROPOSED, StrategyStatus.ARCHIVED],
  PROPOSED: [StrategyStatus.APPROVED, StrategyStatus.DRAFT, StrategyStatus.ARCHIVED],
  APPROVED: [StrategyStatus.ACTIVE, StrategyStatus.ARCHIVED],
  ACTIVE: [StrategyStatus.PAUSED, StrategyStatus.ARCHIVED],
  PAUSED: [StrategyStatus.ACTIVE, StrategyStatus.ARCHIVED],
  ARCHIVED: [],
};

export function assertStrategyTransition(from: StrategyStatus, to: StrategyStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new BadRequestError(`Cannot move strategy from ${from} to ${to}`);
  }
}

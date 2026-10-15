import { StrategyStatus } from '@prisma/client';
import { NotFoundError } from '../../../lib/errors.js';
import { assertStrategyTransition } from './strategies.domain.js';
import type { StrategiesRepository } from './strategies.repository.js';

export type TransitionStrategyDeps = { repo: StrategiesRepository };

export function transitionStrategyService(deps: TransitionStrategyDeps) {
  return async (input: { workspaceId: string; id: string; to: StrategyStatus }) => {
    const strategy = await deps.repo.findById(input.workspaceId, input.id);
    if (!strategy) throw new NotFoundError('Strategy not found');
    assertStrategyTransition(strategy.status, input.to);
    return deps.repo.setStatus(input.id, input.to);
  };
}

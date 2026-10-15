import { BadRequestError } from '../../../../lib/errors.js';
import type { StrategiesRepository } from '../strategies.repository.js';
import type { StrategyCreateBody } from './create-strategy.schema.js';

export type CreateStrategyDeps = { repo: StrategiesRepository };
export type CreateStrategyInput = StrategyCreateBody & { workspaceId: string };

export function createStrategyService(deps: CreateStrategyDeps) {
  return async (input: CreateStrategyInput) => {
    const { goalIds, icpIds = [], workspaceId, ...data } = input;

    const goalsFound = await deps.repo.countGoals(workspaceId, goalIds);
    if (goalsFound !== new Set(goalIds).size) {
      throw new BadRequestError('One or more goals are not in this workspace');
    }
    if (icpIds.length > 0) {
      const icpsFound = await deps.repo.countIcps(workspaceId, icpIds);
      if (icpsFound !== new Set(icpIds).size) {
        throw new BadRequestError('One or more ICPs are not in this workspace');
      }
    }
    return deps.repo.create(workspaceId, data, goalIds, icpIds);
  };
}

import type { GoalsRepository } from '../goals.repository.js';

export type ListGoalsDeps = { repo: GoalsRepository };

export function listGoalsService(deps: ListGoalsDeps) {
  return async (workspaceId: string) => deps.repo.list(workspaceId);
}

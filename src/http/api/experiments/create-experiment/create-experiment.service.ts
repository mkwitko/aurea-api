import { BadRequestError } from '../../../../lib/errors.js';
import type { ExperimentsRepository } from '../experiments.repository.js';
import type { ExperimentCreateBody } from './create-experiment.schema.js';

export type CreateExperimentDeps = { repo: ExperimentsRepository };
export type CreateExperimentInput = ExperimentCreateBody & { workspaceId: string };

export function createExperimentService(deps: CreateExperimentDeps) {
  return async (input: CreateExperimentInput) => {
    const { workspaceId, hypothesisId, ...rest } = input;
    const hypothesis = await deps.repo.findHypothesis(workspaceId, hypothesisId);
    if (!hypothesis) throw new BadRequestError('Hypothesis not found in this workspace');
    return deps.repo.create(workspaceId, { ...rest, hypothesisId, strategyId: hypothesis.strategyId });
  };
}

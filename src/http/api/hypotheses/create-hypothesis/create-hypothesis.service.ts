import { type ConfidenceLevel } from '@prisma/client';
import { BadRequestError } from '../../../../lib/errors.js';
import type { HypothesesRepository } from '../hypotheses.repository.js';
import type { HypothesisCreateBody } from './create-hypothesis.schema.js';

export type CreateHypothesisDeps = { repo: HypothesesRepository };
export type CreateHypothesisInput = HypothesisCreateBody & { workspaceId: string };

export function createHypothesisService(deps: CreateHypothesisDeps) {
  return async (input: CreateHypothesisInput) => {
    const { workspaceId, confidence, ...rest } = input;
    const strategy = await deps.repo.strategyInWorkspace(workspaceId, input.strategyId);
    if (!strategy) throw new BadRequestError('Strategy not found in this workspace');
    return deps.repo.create(workspaceId, { ...rest, confidence: confidence as ConfidenceLevel | undefined });
  };
}

import { HypothesisStatus } from '@prisma/client';
import { NotFoundError } from '../../../lib/errors.js';
import { assertHypothesisTransition } from './hypotheses.domain.js';
import type { HypothesesRepository } from './hypotheses.repository.js';

export type TransitionHypothesisDeps = { repo: HypothesesRepository };

export function transitionHypothesisService(deps: TransitionHypothesisDeps) {
  return async (input: { workspaceId: string; id: string; to: HypothesisStatus }) => {
    const hypothesis = await deps.repo.findById(input.workspaceId, input.id);
    if (!hypothesis) throw new NotFoundError('Hypothesis not found');
    assertHypothesisTransition(hypothesis.status, input.to);
    return deps.repo.setStatus(input.id, input.to);
  };
}

import { type Prisma, LearningStatus } from '@prisma/client';
import { NotFoundError } from '../../../lib/errors.js';
import { assertLearningTransition } from './learnings.domain.js';
import type { LearningsRepository } from './learnings.repository.js';

export type TransitionLearningDeps = { repo: LearningsRepository };

export function transitionLearningService(deps: TransitionLearningDeps) {
  return async (input: {
    workspaceId: string;
    id: string;
    to: LearningStatus;
    extra?: Prisma.LearningUpdateInput;
  }) => {
    const learning = await deps.repo.findById(input.workspaceId, input.id);
    if (!learning) throw new NotFoundError('Learning not found');
    assertLearningTransition(learning.status, input.to);
    return deps.repo.setStatus(input.id, input.to, input.extra ?? {});
  };
}

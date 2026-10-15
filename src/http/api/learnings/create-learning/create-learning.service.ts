import type { ConfidenceLevel, Prisma } from '@prisma/client';
import { NotFoundError } from '../../../../lib/errors.js';
import type { LearningsRepository } from '../learnings.repository.js';

export type CreateLearningDeps = { repo: LearningsRepository };

export function createLearningService(deps: CreateLearningDeps) {
  return async (input: {
    workspaceId: string;
    title: string;
    statement: string;
    experimentId?: string;
    evidence?: unknown;
    confidence?: ConfidenceLevel;
  }) => {
    const { workspaceId, experimentId, evidence, ...rest } = input;

    // A learning may stand on its own — not everything learned comes out of a
    // formal experiment — but when it names one, that experiment has to be this
    // tenant's, or the learning would point at something invisible to it.
    if (experimentId) {
      const experiment = await deps.repo.experimentInWorkspace(workspaceId, experimentId);
      if (!experiment) throw new NotFoundError('Experiment not found');
    }

    return deps.repo.create(workspaceId, {
      ...rest,
      ...(experimentId ? { experimentId } : {}),
      ...(evidence === undefined ? {} : { evidence: evidence as Prisma.InputJsonValue }),
    });
  };
}

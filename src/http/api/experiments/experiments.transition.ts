import { type Prisma, ExperimentStatus } from '@prisma/client';
import { NotFoundError } from '../../../lib/errors.js';
import { assertExperimentTransition } from './experiments.domain.js';
import type { ExperimentsRepository } from './experiments.repository.js';

export type TransitionExperimentDeps = { repo: ExperimentsRepository };
type Row = Awaited<ReturnType<ExperimentsRepository['findById']>>;

export function transitionExperimentService(deps: TransitionExperimentDeps) {
  return async (input: {
    workspaceId: string;
    id: string;
    to: ExperimentStatus;
    // Regra de conteúdo, não de aresta: a tabela de transições diz se o passo
    // existe, o guard diz se este experimento tem o que o passo exige.
    guard?: (current: NonNullable<Row>) => void;
    extra?: (current: NonNullable<Row>) => Prisma.ExperimentUpdateInput;
  }) => {
    const current = await deps.repo.findById(input.workspaceId, input.id);
    if (!current) throw new NotFoundError('Experiment not found');
    assertExperimentTransition(current.status, input.to);
    input.guard?.(current);
    return deps.repo.setStatus(input.id, input.to, input.extra?.(current) ?? {});
  };
}

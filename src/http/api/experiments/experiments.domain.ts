import { ExperimentStatus } from '@prisma/client';
import { BadRequestError } from '../../../lib/errors.js';

export const TRANSITIONS: Record<ExperimentStatus, ExperimentStatus[]> = {
  DRAFT: [ExperimentStatus.PLANNED, ExperimentStatus.CANCELLED],
  PLANNED: [ExperimentStatus.APPROVED, ExperimentStatus.CANCELLED],
  APPROVED: [ExperimentStatus.RUNNING, ExperimentStatus.CANCELLED],
  RUNNING: [ExperimentStatus.PAUSED, ExperimentStatus.COMPLETED, ExperimentStatus.CANCELLED],
  PAUSED: [ExperimentStatus.RUNNING, ExperimentStatus.CANCELLED],
  COMPLETED: [],
  CANCELLED: [],
};

export function assertExperimentTransition(from: ExperimentStatus, to: ExperimentStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new BadRequestError(`Cannot move experiment from ${from} to ${to}`);
  }
}

/**
 * O que um design completo tem, segundo docs/domains/experiments.md §18: um
 * PLANNED define Hypothesis, Variables, Audience, Channel, Metric, Baseline,
 * Target, Duration e Success Criteria.
 *
 * `hypothesisId` fica fora porque é NOT NULL no banco — não há experimento sem
 * hipótese. `variables` também: é Json livre, e a maioria dos testes tem uma
 * variável só, descrita no próprio nome.
 *
 * A trava passou a importar com o auto-plano: nove rascunhos criados de uma vez
 * sem baseline poderiam chegar a RUNNING, e cada Outcome seria comparado com
 * null.
 */
export const PLAN_REQUIRED_FIELDS = [
  'metric',
  'baselineValue',
  'targetValue',
  'startDate',
  'endDate',
  'successCriteria',
  'audience',
  'channel',
] as const;

export type PlanRequiredField = (typeof PLAN_REQUIRED_FIELDS)[number];
export type PlanCandidate = Partial<Record<PlanRequiredField, unknown>>;

export function missingPlanFields(experiment: PlanCandidate): PlanRequiredField[] {
  return PLAN_REQUIRED_FIELDS.filter((field) => {
    const value = experiment[field];
    return value === null || value === undefined || value === '';
  });
}

export function assertReadyToPlan(experiment: PlanCandidate): void {
  const missing = missingPlanFields(experiment);
  if (missing.length) {
    throw new BadRequestError(
      'This experiment is not ready to be planned',
      missing.map((field) => ({ path: field, message: 'required before PLANNED' })),
    );
  }
}

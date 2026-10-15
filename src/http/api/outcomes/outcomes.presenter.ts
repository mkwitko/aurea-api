import type { Outcome } from '@prisma/client';
import { compareMeasurement, type ComparisonInput } from './outcomes.domain.js';

/** The experiment fields a measurement is read against. */
export type ComparisonBasis = Pick<ComparisonInput, 'baselineValue' | 'targetValue'>;

/**
 * Maps a Prisma row to the outcome response, with the comparison computed here
 * rather than in the client: the baseline and the target are the experiment's,
 * and the browser should not have to hold an experiment to read a measurement.
 */
export function presentOutcome(row: Outcome, basis: ComparisonBasis) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    experimentId: row.experimentId,
    metric: row.metric,
    value: row.value,
    unit: row.unit,
    observedAt: row.observedAt,
    source: row.source,
    // Proveniência: nula no número digitado à mão, preenchida no que veio de
    // uma fonte. Repassada e não recalculada — ela é o registro do que foi
    // lido, não uma conclusão sobre isso. `?? null` e não passagem direta:
    // um Outcome digitado à mão nunca teve estas colunas definidas, e a
    // resposta precisa de `null` explícito, não de um campo ausente.
    periodStart: row.periodStart ?? null,
    periodEnd: row.periodEnd ?? null,
    externalRef: row.externalRef ?? null,
    sourceDetail: row.sourceDetail ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    comparison: compareMeasurement({ ...basis, value: row.value }),
  };
}

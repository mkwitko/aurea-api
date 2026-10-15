/**
 * A measurement read against the two numbers the human agreed to beforehand.
 *
 * Arithmetic only, and deliberately so. `docs/domains/analytics.md` §22 asks for
 * observed vs baseline vs target; `docs/domains/experiments.md` §14 forbids
 * turning that into a success verdict, because `successCriteria` is free text
 * and completion is not success. So this returns numbers and no label: the
 * reader compares them, and the judgement lives in a Learning a human wrote.
 */
export interface MeasurementComparison {
  /** Observed minus baseline. Null without a baseline: there is no "moved" without a before. */
  delta: number | null;
  /** The same movement as a percentage of the baseline. Null when the baseline is zero. */
  deltaPct: number | null;
  /** How much of the target the observed value covers. Null when the target is zero. */
  progressPct: number | null;
}

export interface ComparisonInput {
  baselineValue: number | null;
  targetValue: number | null;
  value: number;
}

/** One decimal is the precision a percentage of a hand-typed number deserves. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function compareMeasurement({ baselineValue, targetValue, value }: ComparisonInput): MeasurementComparison {
  const hasBaseline = baselineValue !== null && Number.isFinite(baselineValue);
  const delta = hasBaseline ? round1(value - baselineValue) : null;

  return {
    delta,
    // Zero baseline is not a 100%-of-nothing rise, it is an undefined ratio.
    deltaPct: hasBaseline && baselineValue !== 0 ? round1(((value - baselineValue) / Math.abs(baselineValue)) * 100) : null,
    progressPct:
      targetValue !== null && Number.isFinite(targetValue) && targetValue !== 0
        ? round1((value / targetValue) * 100)
        : null,
  };
}

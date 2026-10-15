import { describe, expect, it } from 'vitest';
import { compareMeasurement } from './outcomes.domain.js';

describe('compareMeasurement', () => {
  it('reads the measurement against the baseline and the target', () => {
    expect(compareMeasurement({ baselineValue: 4.2, targetValue: 5.5, value: 6.1 })).toEqual({
      delta: 1.9,
      deltaPct: 45.2,
      progressPct: 110.9,
    });
  });

  it('reports a fall as a negative movement rather than hiding it', () => {
    expect(compareMeasurement({ baselineValue: 10, targetValue: 20, value: 8 })).toEqual({
      delta: -2,
      deltaPct: -20,
      progressPct: 40,
    });
  });

  it('has no movement to report without a baseline', () => {
    // Sem o número de antes não existe "mexeu": um delta contra nada seria o
    // próprio valor disfarçado de melhora.
    expect(compareMeasurement({ baselineValue: null, targetValue: 20, value: 8 })).toEqual({
      delta: null,
      deltaPct: null,
      progressPct: 40,
    });
  });

  it('has no target to report against without a target', () => {
    expect(compareMeasurement({ baselineValue: 10, targetValue: null, value: 12 })).toEqual({
      delta: 2,
      deltaPct: 20,
      progressPct: null,
    });
  });

  it('refuses to divide by zero in either direction', () => {
    // Partir de zero não é uma alta de 100%, é uma razão indefinida — e o mesmo
    // vale para uma meta de zero.
    expect(compareMeasurement({ baselineValue: 0, targetValue: 0, value: 5 })).toEqual({
      delta: 5,
      deltaPct: null,
      progressPct: null,
    });
  });

  it('measures the movement against the size of the baseline, not its sign', () => {
    // De -20 para -10 o número subiu, e a melhora é de metade de 20.
    expect(compareMeasurement({ baselineValue: -20, targetValue: null, value: -10 })).toEqual({
      delta: 10,
      deltaPct: 50,
      progressPct: null,
    });
  });
});

import { describe, expect, it } from 'vitest';
import { researchGrowthContextAgent } from './research-growth-context.js';

function finding(overrides: Record<string, unknown> = {}) {
  return {
    dimension: 'MARKET',
    statement: 'Demand for ops tooling grew through 2026.',
    evidence: 'Search interest for "ops automation" rose 40% year over year.',
    sourceUrl: 'https://example.test/report',
    sourceTitle: 'State of Ops 2026',
    confidence: 'MEDIUM',
    target: 'TREND',
    ...overrides,
  };
}

const valid = {
  summary: 'The market is growing and weakly served.',
  findings: [finding()],
  opportunities: [
    {
      statement: 'Own the ops-automation search demand.',
      rationale: 'High intent, weak specialised competition.',
      supportingFindings: [0],
      confidence: 'MEDIUM',
    },
  ],
};

const parse = (value: unknown) => researchGrowthContextAgent.outputSchema.safeParse(value);

describe('research-growth-context output schema', () => {
  it('accepts a well-formed research result', () => {
    expect(parse(valid).success).toBe(true);
  });

  it('rejects a result with no findings', () => {
    expect(parse({ ...valid, findings: [] }).success).toBe(false);
  });

  it('rejects more than eight findings', () => {
    expect(parse({ ...valid, findings: Array.from({ length: 9 }, () => finding()) }).success).toBe(false);
  });

  it('cannot express VERIFIED confidence', () => {
    expect(parse({ ...valid, findings: [finding({ confidence: 'VERIFIED' })] }).success).toBe(false);
  });

  it('rejects a COMPETITOR target with no competitor', () => {
    expect(parse({ ...valid, findings: [finding({ target: 'COMPETITOR' })] }).success).toBe(false);
  });

  it('accepts a COMPETITOR target with a competitor', () => {
    const competitor = { name: 'Rival', url: 'https://rival.test', positioning: 'Cheap', strengths: ['price'], weaknesses: ['support'] };
    expect(parse({ ...valid, findings: [finding({ target: 'COMPETITOR', competitor })] }).success).toBe(true);
  });

  it('rejects a competitor object on a non-COMPETITOR target', () => {
    const competitor = { name: 'Rival', strengths: [], weaknesses: [] };
    expect(parse({ ...valid, findings: [finding({ target: 'TREND', competitor })] }).success).toBe(false);
  });

  it('rejects an opportunity pointing at a finding that does not exist', () => {
    expect(parse({ ...valid, opportunities: [{ ...valid.opportunities[0]!, supportingFindings: [3] }] }).success).toBe(false);
  });

  // Cada iteração do laço do runner faz uma chamada ao modelo e os dois tetos
  // olham o mesmo contador, então maxModelCalls abaixo de maxToolIterations
  // deixaria as últimas iterações inalcançáveis. Iguais, o orçamento declarado
  // é o que de fato se pode gastar.
  it('declares a budget bigger than the runner defaults, with the two caps aligned', () => {
    expect(researchGrowthContextAgent.budget).toEqual({
      maxToolIterations: 8,
      maxModelCalls: 8,
      // Derivado do próprio schema, não escolhido a dedo: ver
      // ai/runner/output-budget.test.ts, que exige teto ≥ pior caso aceito.
      maxOutputTokens: 8192,
    });
  });

  // .url() do Zod aceita qualquer scheme. Estas urls são escolhidas por um
  // modelo lendo páginas que um atacante controla, e viram href no frontend.
  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox("x")'])(
    'rejects a source url with the non-web scheme %s',
    (sourceUrl) => {
      expect(parse({ ...valid, findings: [finding({ sourceUrl })] }).success).toBe(false);
    },
  );

  it.each(['http://example.test/report', 'https://example.test/report'])('accepts the web source url %s', (sourceUrl) => {
    expect(parse({ ...valid, findings: [finding({ sourceUrl })] }).success).toBe(true);
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', 'vbscript:msgbox("x")'])(
    'rejects a competitor url with the non-web scheme %s',
    (url) => {
      const competitor = { name: 'Rival', url, strengths: [], weaknesses: [] };
      expect(parse({ ...valid, findings: [finding({ target: 'COMPETITOR', competitor })] }).success).toBe(false);
    },
  );

  it.each(['http://rival.test', 'https://rival.test'])('accepts the web competitor url %s', (url) => {
    const competitor = { name: 'Rival', url, strengths: [], weaknesses: [] };
    expect(parse({ ...valid, findings: [finding({ target: 'COMPETITOR', competitor })] }).success).toBe(true);
  });

  it('is registered and priced', async () => {
    const { getAgent } = await import('./registry.js');
    const { creditCost } = await import('../../billing/operation-cost.js');

    expect(getAgent('research-growth-context')).toBe(researchGrowthContextAgent);
    expect(creditCost('research-growth-context')).toBe(5);
  });
});

import { describe, expect, it } from 'vitest';
import {
  applyResearchToContext,
  lowestConfidence,
  removeResearchFromContext,
  researchPresence,
} from './research-context.js';
import type { ResearchFinding, ResearchOpportunity } from '../../../ai/agents/research-growth-context.js';

const finding = (overrides: Partial<ResearchFinding> = {}): ResearchFinding =>
  ({
    dimension: 'MARKET',
    statement: 'Demand for ops tooling grew through 2026.',
    evidence: 'Search interest rose 40%.',
    sourceUrl: 'https://example.test/report',
    sourceTitle: 'State of Ops 2026',
    confidence: 'MEDIUM',
    target: 'TREND',
    ...overrides,
  }) as ResearchFinding;

describe('applyResearchToContext', () => {
  it('appends a trend to an empty context', () => {
    const result = applyResearchToContext({}, { findings: [finding()], opportunities: [] });

    expect(result).toEqual({
      marketContext: { trends: ['Demand for ops tooling grew through 2026.'] },
    });
  });

  it('keeps every other section untouched', () => {
    const current = { companyProfile: { mission: 'm' }, marketContext: { maturity: 'growth', trends: ['old'] } };

    const result = applyResearchToContext(current, { findings: [finding()], opportunities: [] });

    expect(result.companyProfile).toEqual({ mission: 'm' });
    expect((result.marketContext as Record<string, unknown>).maturity).toBe('growth');
    expect((result.marketContext as Record<string, unknown>).trends).toEqual([
      'old',
      'Demand for ops tooling grew through 2026.',
    ]);
  });

  it('routes a THREAT target to threats', () => {
    const result = applyResearchToContext({}, { findings: [finding({ target: 'THREAT' })], opportunities: [] });

    expect((result.marketContext as Record<string, unknown>).threats).toEqual([
      'Demand for ops tooling grew through 2026.',
    ]);
  });

  it('skips a statement already present, whatever its case or padding', () => {
    const current = { marketContext: { trends: ['  demand for OPS tooling grew through 2026.  '] } };

    const result = applyResearchToContext(current, { findings: [finding()], opportunities: [] });

    expect((result.marketContext as Record<string, unknown>).trends).toHaveLength(1);
  });

  it('appends a competitor as a structured entry', () => {
    const competitor = { name: 'Rival', url: 'https://rival.test', positioning: 'Cheap', strengths: ['price'], weaknesses: ['support'] };

    const result = applyResearchToContext(
      {},
      { findings: [finding({ target: 'COMPETITOR', competitor })], opportunities: [] },
    );

    expect((result.competitiveLandscape as Record<string, unknown>).competitors).toEqual([competitor]);
  });

  it('skips a competitor whose name is already known', () => {
    const current = { competitiveLandscape: { competitors: [{ name: 'rival' }] } };
    const competitor = { name: 'Rival', strengths: [], weaknesses: [] };

    const result = applyResearchToContext(
      current,
      { findings: [finding({ target: 'COMPETITOR', competitor })], opportunities: [] },
    );

    expect((result.competitiveLandscape as Record<string, unknown>).competitors).toHaveLength(1);
  });

  it('appends opportunities to their own field', () => {
    const result = applyResearchToContext(
      {},
      {
        findings: [],
        opportunities: [
          { statement: 'Own the search demand.', rationale: 'r', supportingFindings: [0], confidence: 'HIGH' },
        ],
      },
    );

    expect((result.marketContext as Record<string, unknown>).opportunities).toEqual(['Own the search demand.']);
  });

  it('ignores a NONE target', () => {
    const result = applyResearchToContext({}, { findings: [finding({ target: 'NONE' })], opportunities: [] });

    expect(result).toEqual({});
  });

  it('does not mutate the context it was given', () => {
    const current = { marketContext: { trends: ['old'] } };

    applyResearchToContext(current, { findings: [finding()], opportunities: [] });

    expect(current.marketContext.trends).toEqual(['old']);
  });

  it('shares no reference with the input, even for a field the fold never touches', () => {
    const current = { marketContext: { trends: ['old'], threats: ['scary thing'] } };

    const result = applyResearchToContext(current, { findings: [finding()], opportunities: [] });

    // Only `trends` was written by this call; `threats` rode along untouched.
    // Writing into the result must not reach back into the caller's object.
    (result.marketContext as { threats: string[] }).threats.push('new problem');

    expect(current.marketContext.threats).toEqual(['scary thing']);
  });

  it('shares no reference with the input when no competitor was selected at all', () => {
    const current = { competitiveLandscape: { competitors: [{ name: 'rival' }] } };

    const result = applyResearchToContext(current, { findings: [finding()], opportunities: [] });

    // No COMPETITOR finding means the competitiveLandscape branch never runs,
    // so this is the path where nothing at all would be copied without a
    // clone at the top of the function.
    (result.competitiveLandscape as { competitors: unknown[] }).competitors.push({ name: 'intruder' });

    expect(current.competitiveLandscape.competitors).toEqual([{ name: 'rival' }]);
  });
});

describe('lowestConfidence', () => {
  it('takes the weakest accepted claim', () => {
    expect(lowestConfidence([{ confidence: 'HIGH' }, { confidence: 'LOW' }, { confidence: 'MEDIUM' }])).toBe('LOW');
  });

  it('falls back to MEDIUM for an empty selection', () => {
    expect(lowestConfidence([])).toBe('MEDIUM');
  });

  // MEDIUM é teto, não só piso: o seed do reduce nunca é ultrapassado. Uma
  // versão montada a partir de saída de modelo não é mais confiável que o
  // padrão que um humano recebe, então HIGH não é alcançável por aceite.
  it('caps an all-HIGH selection at MEDIUM', () => {
    expect(lowestConfidence([{ confidence: 'HIGH' }, { confidence: 'HIGH' }])).toBe('MEDIUM');
  });
});

const opportunity = (statement = 'Own the search demand.'): ResearchOpportunity =>
  ({ statement, rationale: 'High intent.', supportingFindings: [0], confidence: 'LOW' }) as ResearchOpportunity;

describe('researchPresence', () => {
  it('reports a trend already in the context and one that is not', () => {
    const current = { marketContext: { trends: ['Demand for ops tooling grew through 2026.'] } };

    const presence = researchPresence(current, {
      findings: [finding(), finding({ statement: 'Something else entirely.' })],
      opportunities: [],
    });

    expect(presence.findings).toEqual([true, false]);
  });

  // A mesma normalização do append: se o append não escreveria (porque
  // considera duplicado), a presença tem de dizer "já está". As duas respostas
  // vindo da mesma regra é o que impede a tela de oferecer guardar algo que
  // guardar não muda.
  it('matches the way the append deduplicates — case and surrounding space', () => {
    const current = { marketContext: { trends: ['  DEMAND for ops tooling grew through 2026.  '] } };

    const presence = researchPresence(current, { findings: [finding()], opportunities: [] });

    expect(presence.findings).toEqual([true]);
  });

  it('reports a competitor by name, not by statement', () => {
    const current = { competitiveLandscape: { competitors: [{ name: 'Northwind' }] } };
    const stored = finding({
      target: 'COMPETITOR',
      statement: 'Anything at all.',
      competitor: { name: 'Northwind', strengths: [], weaknesses: [] },
    });

    expect(researchPresence(current, { findings: [stored], opportunities: [] }).findings).toEqual([true]);
  });

  it('never reports a NONE finding as present, since it has nowhere to be', () => {
    const current = { marketContext: { trends: ['Interesting but unfiled.'] } };
    const unfiled = finding({ target: 'NONE', statement: 'Interesting but unfiled.' });

    expect(researchPresence(current, { findings: [unfiled], opportunities: [] }).findings).toEqual([false]);
  });

  it('reads opportunities out of marketContext.opportunities', () => {
    const current = { marketContext: { opportunities: ['Own the search demand.'] } };

    const presence = researchPresence(current, {
      findings: [],
      opportunities: [opportunity(), opportunity('Something else.')],
    });

    expect(presence.opportunities).toEqual([true, false]);
  });

  it('says nothing is present in an empty context', () => {
    const presence = researchPresence({}, { findings: [finding()], opportunities: [opportunity()] });

    expect(presence).toEqual({ findings: [false], opportunities: [false] });
  });
});

describe('removeResearchFromContext', () => {
  it('drops the accepted trend and leaves the rest of the list alone', () => {
    const current = {
      marketContext: { trends: ['Demand for ops tooling grew through 2026.', 'Written by hand.'], tam: 100 },
    };

    const result = removeResearchFromContext(current, { findings: [finding()], opportunities: [] });

    expect(result.marketContext).toEqual({ trends: ['Written by hand.'], tam: 100 });
  });

  it('drops an opportunity by statement', () => {
    const current = { marketContext: { opportunities: ['Own the search demand.', 'Keep this one.'] } };

    const result = removeResearchFromContext(current, { findings: [], opportunities: [opportunity()] });

    expect(result.marketContext).toEqual({ opportunities: ['Keep this one.'] });
  });

  it('drops a competitor by name and keeps the others', () => {
    const current = { competitiveLandscape: { competitors: [{ name: 'Northwind' }, { name: 'Rival' }] } };
    const stored = finding({
      target: 'COMPETITOR',
      competitor: { name: 'northwind', strengths: [], weaknesses: [] },
    });

    const result = removeResearchFromContext(current, { findings: [stored], opportunities: [] });

    expect(result.competitiveLandscape).toEqual({ competitors: [{ name: 'Rival' }] });
  });

  // Criar `trends: []` numa remoção inventaria uma resposta vazia onde antes
  // havia silêncio, e a completude do contexto leria isso como preenchido.
  it('does not invent an empty list on a context that never had one', () => {
    const result = removeResearchFromContext({}, { findings: [finding()], opportunities: [] });

    expect(result).toEqual({});
  });

  it('leaves the caller data untouched', () => {
    const current = { marketContext: { trends: ['Demand for ops tooling grew through 2026.'] } };

    removeResearchFromContext(current, { findings: [finding()], opportunities: [] });

    expect(current.marketContext.trends).toEqual(['Demand for ops tooling grew through 2026.']);
  });

  it('keeps a competitor entry whose name is not readable, rather than guess', () => {
    const current = { competitiveLandscape: { competitors: [{ noName: true }] } };
    const stored = finding({
      target: 'COMPETITOR',
      competitor: { name: 'Northwind', strengths: [], weaknesses: [] },
    });

    const result = removeResearchFromContext(current, { findings: [stored], opportunities: [] });

    expect(result.competitiveLandscape).toEqual({ competitors: [{ noName: true }] });
  });
});

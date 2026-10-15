import { describe, expect, it } from 'vitest';
import type { ProposedOption } from '../../../../ai/agents/propose-strategies.js';
import { mergeProposedOptions } from './merge-options.js';

const option = (overrides: Partial<ProposedOption> = {}): ProposedOption =>
  ({
    name: 'Founder-led outbound',
    strategicThesis: 'Ops leads answer a person.',
    growthMechanism: 'Outbound',
    expectedOutcome: 'Ten calls',
    channels: ['Email'],
    assumptions: ['They read email'],
    risks: ['Deliverability'],
    tradeoffs: 'Slower than paid.',
    hypotheses: [
      {
        statement: 'Plain text wins',
        rationale: 'Templates read as marketing',
        targetMetric: 'reply_rate',
        expectedOutcome: 'Above 12%',
        confidence: 'MEDIUM',
      },
    ],
    ...overrides,
  }) as ProposedOption;

describe('mergeProposedOptions', () => {
  it('leaves a single option exactly as the agent wrote it', () => {
    const only = option();

    expect(mergeProposedOptions([only])).toEqual({
      name: only.name,
      strategicThesis: only.strategicThesis,
      growthMechanism: only.growthMechanism,
      expectedOutcome: only.expectedOutcome,
      channels: only.channels,
      assumptions: only.assumptions,
      risks: only.risks,
      hypotheses: only.hypotheses,
    });
  });

  it('names the combination after the options that made it', () => {
    const merged = mergeProposedOptions([option(), option({ name: 'Content-led' })]);

    expect(merged.name).toBe('Founder-led outbound + Content-led');
  });

  it('attributes each block of text to the option it came from', () => {
    const merged = mergeProposedOptions([
      option(),
      option({ name: 'Content-led', strategicThesis: 'They search before they buy.' }),
    ]);

    // Sem a atribuição, o plano combinado é um texto que ninguém consegue
    // auditar depois — dois parágrafos sem dono.
    expect(merged.strategicThesis).toBe(
      'Founder-led outbound: Ops leads answer a person.\n\nContent-led: They search before they buy.',
    );
  });

  it('unions the lists instead of concatenating them', () => {
    const merged = mergeProposedOptions([
      option({ channels: ['Email', 'LinkedIn'] }),
      option({ name: 'Content-led', channels: ['email', 'SEO'] }),
    ]);

    // `email` repetido em outra caixa não vira um segundo canal.
    expect(merged.channels).toEqual(['Email', 'LinkedIn', 'SEO']);
  });

  it('keeps every hypothesis of every option', () => {
    const merged = mergeProposedOptions([option(), option({ name: 'Content-led' })]);

    expect(merged.hypotheses).toHaveLength(2);
  });

  it('names both mechanisms when they differ, and neither twice when they do not', () => {
    expect(mergeProposedOptions([option(), option({ name: 'Content-led', growthMechanism: 'Content' })]).growthMechanism)
      .toBe('Outbound + Content');
    expect(mergeProposedOptions([option(), option({ name: 'Second outbound' })]).growthMechanism).toBe('Outbound');
  });

  // O corte é visível de propósito: o fundador vê este texto num formulário
  // editável antes de gravar, e um corte silencioso no banco seria pior.
  it('cuts a merged text that would not fit the column, at a word boundary', () => {
    const long = 'palavra '.repeat(400).trim();
    const merged = mergeProposedOptions([option({ strategicThesis: long }), option({ name: 'B', strategicThesis: long })]);

    expect(merged.strategicThesis.length).toBeLessThanOrEqual(2000);
    expect(merged.strategicThesis.endsWith('…')).toBe(true);
    expect(merged.strategicThesis).not.toContain('palavr…');
  });

  it('cuts a merged name that would not fit, rather than letting the write fail', () => {
    const merged = mergeProposedOptions([
      option({ name: 'a'.repeat(150) }),
      option({ name: 'b'.repeat(150) }),
    ]);

    expect(merged.name.length).toBeLessThanOrEqual(200);
  });
});

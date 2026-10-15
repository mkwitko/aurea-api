import { describe, expect, it } from 'vitest';
import { interpretOutcomeAgent, verifyEvidence } from './interpret-outcome.js';
import type { InterpretOutcomeOutput } from './interpret-outcome.js';

const VALID: InterpretOutcomeOutput = {
  reading: 'Replies reached 18 against a baseline of 4 and a target of 25.',
  drivers: ['The list was filtered to founders who raised in the last 90 days.'],
  caveats: ['One month is a short window for a reply-rate signal.'],
  learning: {
    title: 'Funding-round personalization lifts reply rate',
    statement: 'Referencing a recent raise in the first line lifted replies well above baseline.',
    evidence: ['18 replies recorded on 2026-07-30', 'baseline was 4'],
    confidence: 'MEDIUM',
  },
};

function parse(output: unknown) {
  return interpretOutcomeAgent.outputSchema.safeParse(output);
}

describe('interpret-outcome contract', () => {
  it('accepts a well-formed result', () => {
    expect(parse(VALID).success).toBe(true);
  });

  it('is registered with the id, tier and search requirement the spec fixes', () => {
    expect(interpretOutcomeAgent.taskType).toBe('interpret-outcome');
    expect(interpretOutcomeAgent.agentType).toBe('outcome-analyst');
    expect(interpretOutcomeAgent.tier).toBe('TIER2');
    expect(interpretOutcomeAgent.requiresSearch ?? false).toBe(false);
  });

  it('has nowhere to record a success verdict', () => {
    // Spec §3.1: the refusal is structural. A model that tries to rule anyway
    // produces an unknown key, and an unknown key fails the whole result —
    // so no screen can ever render a verdict this system did not define.
    expect(parse({ ...VALID, verdict: 'MET' }).success).toBe(false);
    expect(parse({ ...VALID, learning: { ...VALID.learning, met: true } }).success).toBe(false);
  });

  it('refuses VERIFIED confidence', () => {
    // The Prisma enum offers it; one experiment does not verify anything.
    expect(parse({ ...VALID, learning: { ...VALID.learning, confidence: 'VERIFIED' } }).success).toBe(false);
  });

  it('requires at least one driver and at least one piece of evidence', () => {
    expect(parse({ ...VALID, drivers: [] }).success).toBe(false);
    expect(parse({ ...VALID, learning: { ...VALID.learning, evidence: [] } }).success).toBe(false);
  });

  it('allows no caveats but caps them at three', () => {
    expect(parse({ ...VALID, caveats: [] }).success).toBe(true);
    expect(parse({ ...VALID, caveats: ['a', 'b', 'c', 'd'] }).success).toBe(false);
  });

  it('caps the fields that land in unbounded Learning columns', () => {
    expect(parse({ ...VALID, learning: { ...VALID.learning, title: 'x'.repeat(201) } }).success).toBe(false);
    expect(parse({ ...VALID, learning: { ...VALID.learning, statement: 'x'.repeat(1001) } }).success).toBe(false);
    expect(parse({ ...VALID, reading: 'x'.repeat(1501) }).success).toBe(false);
  });

  it('builds exactly one tool, and no web search', () => {
    const tools = interpretOutcomeAgent.buildTools({ experimentId: '11111111-1111-1111-1111-111111111111' });
    expect(tools.map((tool) => tool.name)).toEqual(['get_experiment_result']);
  });

  describe('prose verdict guard (final review, human ruling)', () => {
    // Spec §3.1 amended: the schema has no verdict FIELD, but `reading`,
    // `drivers`, `caveats` and `learning.statement`/`title` are unconstrained
    // strings, rendered verbatim and persisted into Learning on accept. The
    // three structural layers (unknown top-level key, unknown key inside
    // `learning`, VERIFIED confidence) only reject unknown KEYS — a verdict
    // written as prose sails through all three.

    it('rejects a verdict written as prose in reading', () => {
      const result = parse({
        ...VALID,
        reading: 'This experiment was a success — 18 replies against a target of 25.',
      });
      expect(result.success).toBe(false);
    });

    it('rejects a verdict written as prose in each driver', () => {
      expect(parse({ ...VALID, drivers: ['The campaign worked because of the funding-round angle.'] }).success)
        .toBe(false);
    });

    it('rejects a verdict written as prose in each caveat', () => {
      expect(parse({ ...VALID, caveats: ["Even so, this didn't work for cold audiences."] }).success).toBe(false);
    });

    it('rejects a verdict written as prose in learning.statement', () => {
      expect(
        parse({ ...VALID, learning: { ...VALID.learning, statement: 'The experiment failed to move replies.' } })
          .success,
      ).toBe(false);
    });

    it('rejects a verdict written as prose in learning.title', () => {
      // Decision: title carries the guard too. It is rendered as the
      // Learning card headline and persisted the same way as statement — the
      // same risk, not a smaller one for being shorter.
      expect(parse({ ...VALID, learning: { ...VALID.learning, title: 'The experiment succeeded on replies' } }).success)
        .toBe(false);
    });

    it('rejects a verdict written as prose in learning.evidence', () => {
      // Same rendering path and same persistence as title and statement:
      // evidence entries are shown verbatim in the panel and written to
      // Learning.evidence.points on accept.
      expect(
        parse({ ...VALID, learning: { ...VALID.learning, evidence: ['the run was a success at 18 replies'] } })
          .success,
      ).toBe(false);
    });

    it('does not false-positive on legitimate prose carrying numbers and hedges', () => {
      // Guard against the obvious failure mode: a regex that also catches
      // ordinary, non-verdict language that merely contains a number or a
      // hedge word.
      const first =
        'Replies climbed from 4 to 18 over the four-week window, a meaningful but not definitive shift.';
      const second =
        'One experiment is a thin base for confidence, and the gain may not hold once outreach volume increases.';
      expect(parse({ ...VALID, reading: first }).success).toBe(true);
      expect(parse({ ...VALID, caveats: [second] }).success).toBe(true);
    });

    it('lets the model quote successCriteria back and describe things that broke', () => {
      // get_experiment_result hands the model `successCriteria` on purpose
      // (spec §3.1) — quoting the criterion is the design, not a ruling. And
      // "two send days failed to deliver" is causal prose about the mechanics,
      // not a verdict on the experiment. Banning the bare words refused both.
      const quoting = 'The success criteria asked for 25 replies over 30 days; 18 were recorded.';
      const causal = 'Two of the eight send days failed to deliver, so the window was effectively shorter.';
      const mechanism = 'The list build worked from a funding-round filter rather than a title filter.';
      expect(parse({ ...VALID, reading: quoting }).success).toBe(true);
      expect(parse({ ...VALID, caveats: [causal] }).success).toBe(true);
      expect(parse({ ...VALID, drivers: [mechanism] }).success).toBe(true);
    });
  });

  describe('invention guard — verifyEvidence (spec §5/§6)', () => {
    const toolResult = {
      experiment: { metric: 'replies', baselineValue: 4, targetValue: 25 },
      outcomes: [{ metric: 'replies', value: 18, observedAt: '2026-07-30T00:00:00.000Z' }],
    };

    it('refuses an evidence entry citing a number absent from the tool response', () => {
      const output: InterpretOutcomeOutput = {
        ...VALID,
        learning: { ...VALID.learning, evidence: ['42 replies recorded on 2026-07-30'] },
      };
      const result = verifyEvidence(output, [toolResult]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.feedback).toMatch(/42/);
    });

    it('accepts evidence whose numbers and dates all appear in the tool response', () => {
      const output: InterpretOutcomeOutput = {
        ...VALID,
        learning: {
          ...VALID.learning,
          evidence: ['18 replies recorded on 2026-07-30', 'baseline was 4, target was 25'],
        },
      };
      expect(verifyEvidence(output, [toolResult]).ok).toBe(true);
    });
  });

  it('tells the model it may not characterise the experiment as a success or a failure', () => {
    const messages = interpretOutcomeAgent.buildMessages(
      { experimentId: '11111111-1111-1111-1111-111111111111' },
      { tenant: { userId: 'u1', organizationId: 'org-1', workspaceId: 'w1', role: 'MEMBER' } },
    );
    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    // Prompt-level guards are fallible, which is why the schema carries the
    // real guarantee — but a missing instruction is still a defect.
    for (const word of ['successful', 'failed', 'worked']) {
      expect(system).toContain(word);
    }
    expect(system).toContain('get_experiment_result');
  });
});

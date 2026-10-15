import { describe, expect, it } from 'vitest';
import { getAgent } from './registry.js';
import { proposeStrategiesAgent } from './propose-strategies.js';

const tenant = { userId: 'u1', organizationId: 'o1', workspaceId: 'ws-1', role: 'OWNER' as const };
const input = { goalId: '3f1e8f6e-1f1a-4f0e-9b0e-0f6d3b7a1c22' };

function option(over: Record<string, unknown> = {}) {
  return {
    name: 'Founder-led outbound',
    strategicThesis: 'Ops leads answer a person, not a campaign.',
    growthMechanism: 'Outbound',
    expectedOutcome: 'Ten discovery calls in three weeks',
    channels: ['Email'],
    assumptions: ['Ops leads read email'],
    risks: ['Deliverability'],
    tradeoffs: 'Slower than paid, but cheaper to learn from.',
    hypotheses: [
      { statement: 'Plain text outperforms templates', rationale: 'Templates read as marketing', targetMetric: 'reply_rate', expectedOutcome: 'Reply rate above 12%', confidence: 'MEDIUM' },
      { statement: 'Three touches beat one', rationale: 'One touch is missed, not refused', targetMetric: 'reply_rate', expectedOutcome: 'Reply rate above 15%', confidence: 'LOW' },
    ],
    ...over,
  };
}

function output(over: Record<string, unknown> = {}) {
  return { options: [option(), option({ name: 'Content-led' })], recommendedIndex: 0, rationale: 'Cheapest way to learn.', ...over };
}

describe('propose-strategies agent', () => {
  it('is reachable through the registry by taskType', () => {
    expect(getAgent('propose-strategies')).toBe(proposeStrategiesAgent);
  });

  it('requires a goalId in the input', () => {
    expect(proposeStrategiesAgent.inputSchema.safeParse({}).success).toBe(false);
    expect(proposeStrategiesAgent.inputSchema.safeParse(input).success).toBe(true);
  });

  it('reads the present and the past: growth context bound to the run goal, plus the learnings', () => {
    // Sem get_learnings o estrategista propõe na décima volta o mesmo que na
    // primeira, e a promessa de melhorar a cada ciclo não se sustenta.
    expect(proposeStrategiesAgent.buildTools(input).map((t) => t.name)).toEqual([
      'get_growth_context',
      'get_learnings',
    ]);
  });

  it('forbids proposing again what a learning already ruled out', () => {
    const text = proposeStrategiesAgent
      .buildMessages(input, { tenant })
      .map((m) => ('content' in m ? m.content : ''))
      .join('\n');
    expect(text).toContain('get_learnings');
    expect(text).toMatch(/already ruled out/i);
    // Um aprendizado citado tem de existir: um título inventado é pior que
    // nenhum, porque parece histórico.
    expect(text).toMatch(/never invent one/i);
  });

  it('tells the model how a run ends, now that submit_answer replaces json mode', () => {
    const text = proposeStrategiesAgent
      .buildMessages(input, { tenant })
      .map((m) => ('content' in m ? m.content : ''))
      .join('\n');
    expect(text).toContain('submit_answer');
  });

  it('asks for a mechanism name, not the prose that the 160-char cap refuses', () => {
    // Um parágrafo em growthMechanism é recusado por submit_answer, e a recusa
    // se repete até esgotar maxModelCalls — o run morre FAILED. O prompt tem de
    // pedir nome curto aqui e mandar a explicação para strategicThesis.
    const text = proposeStrategiesAgent
      .buildMessages(input, { tenant })
      .map((m) => ('content' in m ? m.content : ''))
      .join('\n');
    expect(text).toMatch(/growthMechanism: NAME/);
    expect(text).toMatch(/160 characters/);
    expect(text).toMatch(/strategicThesis: this is where the explanation goes/);
  });

  it('tells the model that retrieved content is data, not instructions', () => {
    const system = proposeStrategiesAgent.buildMessages(input, { tenant })[0]!;
    expect('content' in system ? system.content : '').toMatch(/not instructions/i);
  });

  it('accepts a well-formed proposal set', () => {
    expect(proposeStrategiesAgent.outputSchema.safeParse(output()).success).toBe(true);
  });

  it('rejects one option and rejects four', () => {
    // Truncating or padding a malformed answer would let it through as a
    // proposal. Options are the whole point: one is not a choice.
    expect(proposeStrategiesAgent.outputSchema.safeParse(output({ options: [option()] })).success).toBe(false);
    expect(
      proposeStrategiesAgent.outputSchema.safeParse({ ...output(), options: [option(), option(), option(), option()] })
        .success,
    ).toBe(false);
  });

  it('rejects a recommendation pointing outside the options', () => {
    expect(proposeStrategiesAgent.outputSchema.safeParse(output({ recommendedIndex: 5 })).success).toBe(false);
    expect(proposeStrategiesAgent.outputSchema.safeParse(output({ recommendedIndex: -1 })).success).toBe(false);
  });

  it('rejects an option carrying a single hypothesis', () => {
    expect(
      proposeStrategiesAgent.outputSchema.safeParse(output({ options: [option({ hypotheses: [option().hypotheses[0]] }), option()] }))
        .success,
    ).toBe(false);
  });
});

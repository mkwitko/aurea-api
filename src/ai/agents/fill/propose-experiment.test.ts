import { describe, expect, it, vi } from 'vitest';
import { proposeExperimentAgent } from './propose-experiment.js';
import { NotFoundError } from '../../../lib/errors.js';

const TENANT = { userId: 'u1', organizationId: 'org-1', workspaceId: 'w1', role: 'MEMBER' as const };
const INPUT = { hypothesisId: '44444444-4444-4444-4444-444444444444' };

function deps(hypothesis: unknown) {
  const findFirst = vi.fn().mockResolvedValue(hypothesis);
  return { findFirst, deps: { prisma: { hypothesis: { findFirst } } as never, tenant: TENANT } };
}

const QUESTION = {
  id: 'baseline',
  ask: 'Quantas respostas vocês recebem hoje, a cada 100 e-mails?',
  why: 'Sem o número de hoje não dá para saber se o teste melhorou algo.',
  answerType: 'number',
  fills: 'baselineValue',
  impact: 3,
};

const OK = {
  filled: {
    name: 'Funding-round personalization on cold outbound',
    metric: 'reply rate',
    description: 'Two sequences, same list, one personalized by funding round',
    objective: 'Find out whether the personalization is worth its cost',
    channel: 'outbound email',
    audience: 'Series A heads of growth',
    successCriteria: 'the personalized sequence beats the control on reply rate',
  },
  questions: [QUESTION],
  confidence: 'MEDIUM',
};

describe('propose-experiment output', () => {
  const schema = proposeExperimentAgent.outputSchema;

  it('accepts an experiment draft that asks for the numbers and the dates', () => {
    expect(schema.safeParse(OK).success).toBe(true);
  });

  it('rejects filled baseline, target and dates', () => {
    // The number it starts from, the bar it must clear and when it runs are
    // the founder's — and a fabricated baseline poisons every later reading.
    expect(schema.safeParse({ ...OK, filled: { ...OK.filled, baselineValue: 4 } }).success).toBe(false);
    expect(schema.safeParse({ ...OK, filled: { ...OK.filled, targetValue: 7 } }).success).toBe(false);
    expect(schema.safeParse({ ...OK, filled: { ...OK.filled, startDate: '2026-08-01' } }).success).toBe(false);
  });

  it('allows asking for each of them, with the answerType the field accepts', () => {
    // A data é texto ISO, o baseline e o alvo são números. O tipo é do campo,
    // não do modelo: uma data num campo numérico (ou o contrário) reprova o
    // Salvar do experimento depois de o crédito ter sido gasto.
    for (const [fills, answerType] of [
      ['baselineValue', 'number'],
      ['targetValue', 'number'],
      ['startDate', 'text'],
      ['endDate', 'text'],
    ]) {
      expect(
        schema.safeParse({ ...OK, questions: [{ ...QUESTION, id: fills, fills, answerType }] }).success,
      ).toBe(true);
    }
  });

  it('refuses a date answerType on a numeric field, and a number on a date', () => {
    expect(
      schema.safeParse({ ...OK, questions: [{ ...QUESTION, fills: 'baselineValue', answerType: 'text' }] }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ ...OK, questions: [{ ...QUESTION, id: 'start', fills: 'startDate', answerType: 'count' }] })
        .success,
    ).toBe(false);
  });

  it('rejects a hypothesisId in filled', () => {
    expect(schema.safeParse({ ...OK, filled: { ...OK.filled, hypothesisId: 'other' } }).success).toBe(false);
  });
});

describe('propose-experiment tools', () => {
  it('reads the hypothesis and what past tests taught', () => {
    expect(proposeExperimentAgent.buildTools(INPUT).map((tool) => tool.name)).toEqual([
      'get_hypothesis',
      'get_learnings',
    ]);
  });
});

describe('propose-experiment precheck', () => {
  it('passes for a hypothesis in this workspace', async () => {
    const { deps: d } = deps({ id: INPUT.hypothesisId });
    await expect(proposeExperimentAgent.precheck!(INPUT, d)).resolves.toBeUndefined();
  });

  it('refuses a hypothesis in another workspace as not found', async () => {
    const { deps: d } = deps(null);
    await expect(proposeExperimentAgent.precheck!(INPUT, d)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('scopes its lookup to the workspace', async () => {
    const { findFirst, deps: d } = deps({ id: INPUT.hypothesisId });
    await proposeExperimentAgent.precheck!(INPUT, d);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: INPUT.hypothesisId, workspaceId: 'w1' } }),
    );
  });
});

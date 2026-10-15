import { describe, expect, it, vi } from 'vitest';
import { proposeContextSectionAgent } from './propose-context-section.js';
import type { ProposableSection } from './context-sections.js';
import { NotFoundError, SectionNotProposableError } from '../../../lib/errors.js';

const TENANT = { userId: 'u1', organizationId: 'org-1', workspaceId: 'w1', role: 'MEMBER' as const };
const BUSINESS_ID = '11111111-1111-1111-1111-111111111111';
const INPUT = { businessId: BUSINESS_ID, section: 'market' as const };

function deps(business: unknown) {
  const findFirst = vi.fn().mockResolvedValue(business);
  return { findFirst, deps: { prisma: { business: { findFirst } } as never, tenant: TENANT } };
}

describe('propose-context-section input', () => {
  it('accepts a proposable section', () => {
    expect(proposeContextSectionAgent.inputSchema.safeParse(INPUT).success).toBe(true);
  });

  it('rejects projects and campaigns at the schema, before the precheck runs', () => {
    for (const section of ['projects', 'campaigns', 'nonsense']) {
      expect(
        proposeContextSectionAgent.inputSchema.safeParse({ businessId: BUSINESS_ID, section }).success,
      ).toBe(false);
    }
  });
});

describe('propose-context-section precheck', () => {
  it('passes for a business in this workspace', async () => {
    const { deps: d } = deps({ id: BUSINESS_ID });
    await expect(proposeContextSectionAgent.precheck!(INPUT, d)).resolves.toBeUndefined();
  });

  it('refuses a business in another workspace', async () => {
    const { deps: d } = deps(null);
    await expect(proposeContextSectionAgent.precheck!(INPUT, d)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses a section with nothing to propose', async () => {
    // Reached when the input schema is bypassed — the precheck is the safety
    // net, and the founder must never be charged for a run that would return
    // an empty proposal by construction.
    const { deps: d } = deps({ id: BUSINESS_ID });
    await expect(
      proposeContextSectionAgent.precheck!({ businessId: BUSINESS_ID, section: 'projects' } as never, d),
    ).rejects.toBeInstanceOf(SectionNotProposableError);
  });
});

describe('propose-context-section verifyOutput', () => {
  const verify = proposeContextSectionAgent.verifyOutput!;

  const marketOnly = {
    filled: { marketContext: { tam: 1_000 } },
    questions: [
      {
        id: 'sam',
        ask: 'Que fatia desse mercado vocês conseguem atender hoje?',
        why: 'Define o tamanho real do alvo.',
        answerType: 'currency' as const,
        fills: 'marketContext.sam',
        impact: 3 as const,
      },
    ],
    confidence: 'MEDIUM' as const,
  };

  it('accepts a proposal confined to the requested section', () => {
    expect(verify(marketOnly, [], INPUT)).toEqual({ ok: true });
  });

  it('rejects a filled section the run did not ask for', () => {
    const strayed = {
      ...marketOnly,
      filled: { ...marketOnly.filled, companyProfile: { mission: 'Ship growth' } },
    };
    const result = verify(strayed, [], INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.feedback).toContain('companyProfile');
  });

  it('rejects a question aimed outside the requested section', () => {
    const strayed = {
      ...marketOnly,
      questions: [{ ...marketOnly.questions[0]!, id: 'mrr', fills: 'currentPerformance.mrr' }],
    };
    const result = verify(strayed, [], INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.feedback).toContain('currentPerformance.mrr');
  });

  it('accepts a performance run that fills nothing and only asks', () => {
    // The whole point of that section: twelve fields, zero researchable.
    const performance = {
      filled: {},
      questions: [
        {
          id: 'mrr',
          ask: 'Quanto a empresa faturou no último mês?',
          why: 'É a base de tudo.',
          answerType: 'currency' as const,
          fills: 'currentPerformance.mrr',
          impact: 3 as const,
        },
      ],
      confidence: 'LOW' as const,
    };
    expect(verify(performance, [], { businessId: BUSINESS_ID, section: 'performance' })).toEqual({ ok: true });
  });
});

describe('propose-context-section registration', () => {
  it('needs no search — it rereads what the full run already stored', () => {
    expect(proposeContextSectionAgent.requiresSearch).toBeFalsy();
    expect(proposeContextSectionAgent.taskType).toBe('propose-context-section');
  });
});

describe('per-section system prompt', () => {
  const systemFor = (section: ProposableSection) =>
    proposeContextSectionAgent.buildMessages(
      { businessId: '00000000-0000-4000-8000-000000000000', section },
      {} as never,
    )[0]!.content!;

  it('offers only the fills of the requested section', () => {
    const market = systemFor('market');
    expect(market).toContain('marketContext.sam');
    // Um fills de outra seção na lista é uma tentativa que o verifySection
    // reprova depois de paga.
    expect(market).not.toContain('constraints.teamSize');
    expect(market).not.toContain('currentPerformance.mrr');
  });

  it('tells a section with no askable field to return no questions', () => {
    const company = systemFor('company');
    expect(company).toContain('questions must be an empty array');
    expect(company).not.toContain('constraints.urgency');
  });
});

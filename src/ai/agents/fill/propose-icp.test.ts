import { describe, expect, it, vi } from 'vitest';
import { proposeIcpAgent } from './propose-icp.js';
import { BusinessContextTooEmptyError, NotFoundError } from '../../../lib/errors.js';

const TENANT = { userId: 'u1', organizationId: 'org-1', workspaceId: 'w1', role: 'MEMBER' as const };
const INPUT = { businessId: '11111111-1111-1111-1111-111111111111' };

/** `context` is the JSON blob stored on the current version, or null for none. */
function deps(business: unknown, context: unknown) {
  const businessFindFirst = vi.fn().mockResolvedValue(business);
  const contextFindUnique = vi.fn().mockResolvedValue(context);
  return {
    businessFindFirst,
    contextFindUnique,
    deps: {
      prisma: {
        business: { findFirst: businessFindFirst },
        businessContext: { findUnique: contextFindUnique },
      } as never,
      tenant: TENANT,
    },
  };
}

const THREE_SECTIONS = {
  currentVersion: {
    data: {
      companyProfile: { mission: 'Ship growth' },
      products: [{ id: 'p1', name: 'AUREA', description: 'Growth OS' }],
      marketContext: { tam: 1_000 },
    },
  },
};

const OK = {
  filled: {
    name: 'Founder without a growth team',
    description: 'Owns the number and has no one to delegate to',
    painPoints: ['no time to run experiments'],
    characteristics: ['5-40 employees'],
    customerGoals: ['predictable pipeline'],
    buyingTriggers: ['missed a quarter'],
    objections: ['another tool to learn'],
  },
  questions: [],
  confidence: 'MEDIUM',
};

describe('propose-icp output', () => {
  const schema = proposeIcpAgent.outputSchema;

  it('accepts a full ICP draft', () => {
    expect(schema.safeParse(OK).success).toBe(true);
  });

  it('rejects a status or an id — those belong to the row, not the draft', () => {
    expect(schema.safeParse({ ...OK, filled: { ...OK.filled, status: 'ACTIVE' } }).success).toBe(false);
    expect(schema.safeParse({ ...OK, filled: { ...OK.filled, id: 'icp-1' } }).success).toBe(false);
  });

  it('permits no question', () => {
    expect(
      schema.safeParse({
        ...OK,
        questions: [{ id: 'q', ask: 'a', why: 'b', answerType: 'text', fills: 'name', impact: 1 }],
      }).success,
    ).toBe(false);
  });
});

describe('propose-icp precheck', () => {
  it('passes with three filled sections', async () => {
    const { deps: d } = deps({ id: INPUT.businessId }, THREE_SECTIONS);
    await expect(proposeIcpAgent.precheck!(INPUT, d)).resolves.toBeUndefined();
  });

  it('refuses when fewer than three sections are filled', async () => {
    // An ICP drawn from an empty context is the model describing a generic
    // buyer back at the founder, at their expense.
    const { deps: d } = deps(
      { id: INPUT.businessId },
      { currentVersion: { data: { companyProfile: { mission: 'x' }, products: [] } } },
    );
    await expect(proposeIcpAgent.precheck!(INPUT, d)).rejects.toBeInstanceOf(BusinessContextTooEmptyError);
  });

  it('counts an empty array as unfilled', async () => {
    const { deps: d } = deps(
      { id: INPUT.businessId },
      { currentVersion: { data: { companyProfile: {}, products: [], projects: [], campaigns: [] } } },
    );
    await expect(proposeIcpAgent.precheck!(INPUT, d)).rejects.toBeInstanceOf(BusinessContextTooEmptyError);
  });

  it('refuses when there is no context at all', async () => {
    const { deps: d } = deps({ id: INPUT.businessId }, null);
    await expect(proposeIcpAgent.precheck!(INPUT, d)).rejects.toBeInstanceOf(BusinessContextTooEmptyError);
  });

  it('refuses a business in another workspace', async () => {
    const { deps: d } = deps(null, THREE_SECTIONS);
    await expect(proposeIcpAgent.precheck!(INPUT, d)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('scopes the business lookup to the workspace', async () => {
    const { businessFindFirst, deps: d } = deps({ id: INPUT.businessId }, THREE_SECTIONS);
    await proposeIcpAgent.precheck!(INPUT, d);
    expect(businessFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: INPUT.businessId, workspaceId: 'w1', deletedAt: null } }),
    );
  });
});

describe('propose-icp budget', () => {
  // Run ebf8e706: o submit_answer saiu cortado pelo teto de 2048 tokens, o
  // guardrail pediu uma resposta menor, e as 3 iterações acabaram antes de o
  // modelo conseguir mandá-la — run FAILED, crédito estornado, fundador sem
  // ICP. O pior caso que o próprio schema aceita (descrição de 2000 caracteres
  // + cinco listas de seis itens de 200) passa de 2000 tokens.
  it('cabe o pior caso do schema e deixa iteração para o corretivo', () => {
    expect(proposeIcpAgent.budget?.maxOutputTokens).toBe(4096);
    expect(proposeIcpAgent.budget?.maxToolIterations).toBe(6);
    expect(proposeIcpAgent.budget?.maxModelCalls).toBe(8);
  });
});

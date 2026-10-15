import { describe, expect, it, vi } from 'vitest';
import { proposeBusinessProfileAgent } from './propose-business-profile.js';
import { BusinessWebsiteRequiredError } from '../../../lib/errors.js';
import { NotFoundError } from '../../../lib/errors.js';

const TENANT = { userId: 'u1', organizationId: 'org-1', workspaceId: 'w1', role: 'MEMBER' as const };
// website is required on Input (see propose-business-profile.ts); the brief's
// fixture omitted it, which fails strict tsc on every precheck! call below.
const INPUT = { businessId: '11111111-1111-1111-1111-111111111111', website: 'https://acme.example' };

function deps(business: unknown) {
  const findFirst = vi.fn().mockResolvedValue(business);
  return { findFirst, deps: { prisma: { business: { findFirst } } as never, tenant: TENANT } };
}

const OK = {
  filled: {
    description: 'Growth OS for founders',
    industry: 'SaaS',
    businessModel: 'B2B SaaS',
    revenueModel: 'subscription',
    valueProposition: 'From goal to experiment in a week',
    positioning: 'For founders without a growth team',
  },
  questions: [],
  confidence: 'MEDIUM',
};

describe('propose-business-profile output', () => {
  const schema = proposeBusinessProfileAgent.outputSchema;

  it('accepts the six researchable fields', () => {
    expect(schema.safeParse(OK).success).toBe(true);
  });

  it('rejects name and website — those are the user\'s, not the model\'s', () => {
    expect(schema.safeParse({ ...OK, filled: { ...OK.filled, name: 'AUREA' } }).success).toBe(false);
    expect(schema.safeParse({ ...OK, filled: { ...OK.filled, website: 'https://x.com' } }).success).toBe(false);
  });

  it('rejects an unknown key at the top level', () => {
    expect(schema.safeParse({ ...OK, notes: 'extra' }).success).toBe(false);
  });

  it('permits no question at all', () => {
    // Every field here comes off the site. There is nothing only the founder
    // knows, so the contract forbids the list rather than leaving it optional.
    expect(schema.safeParse({ ...OK, questions: [{ id: 'q', ask: 'a', why: 'b', answerType: 'text', fills: 'industry', impact: 1 }] }).success).toBe(false);
  });
});

describe('propose-business-profile precheck', () => {
  it('passes for a business that has a website', async () => {
    const { deps: d } = deps({ website: 'https://aurea.dev' });
    await expect(proposeBusinessProfileAgent.precheck!(INPUT, d)).resolves.toBeUndefined();
  });

  it('refuses a business with no website, before any charge', async () => {
    const { deps: d } = deps({ website: null });
    await expect(proposeBusinessProfileAgent.precheck!(INPUT, d)).rejects.toBeInstanceOf(
      BusinessWebsiteRequiredError,
    );
  });

  it('refuses a blank website', async () => {
    const { deps: d } = deps({ website: '   ' });
    await expect(proposeBusinessProfileAgent.precheck!(INPUT, d)).rejects.toBeInstanceOf(
      BusinessWebsiteRequiredError,
    );
  });

  it('refuses a business in another workspace as not found', async () => {
    const { deps: d } = deps(null);
    await expect(proposeBusinessProfileAgent.precheck!(INPUT, d)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('scopes its lookup to the workspace', async () => {
    const { findFirst, deps: d } = deps({ website: 'https://aurea.dev' });
    await proposeBusinessProfileAgent.precheck!(INPUT, d);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: INPUT.businessId, workspaceId: 'w1', deletedAt: null } }),
    );
  });
});

describe('propose-business-profile registration', () => {
  it('declares the search it needs so the run is refused when search is down', () => {
    expect(proposeBusinessProfileAgent.requiresSearch).toBe(true);
    expect(proposeBusinessProfileAgent.taskType).toBe('propose-business-profile');
    expect(proposeBusinessProfileAgent.tier).toBe('TIER2');
  });

  it('requires a url on the input', () => {
    // The run's input is the trusted channel for the website; a non-url would
    // reach the model as a search term instead of a page.
    expect(proposeBusinessProfileAgent.inputSchema.safeParse({ businessId: INPUT.businessId }).success).toBe(false);
    expect(
      proposeBusinessProfileAgent.inputSchema.safeParse({ ...INPUT, website: 'aurea' }).success,
    ).toBe(false);
    expect(
      proposeBusinessProfileAgent.inputSchema.safeParse({ ...INPUT, website: 'https://aurea.dev' }).success,
    ).toBe(true);
  });
});

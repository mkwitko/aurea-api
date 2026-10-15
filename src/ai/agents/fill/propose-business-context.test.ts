import { describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../../lib/errors.js';

// buildTools() constructs the real web-search tool via
// createSearchProviderFromEnv(), which throws without TAVILY_API_KEY — unset
// in this test env (vitest.config.ts) and stubbed by no test in this repo.
// Stubbing the factory here (rather than the env var) lets buildTools() run
// for real and keeps the assertions below honest about what it returns and
// how it wires get_business_context, instead of dropping that coverage.
vi.mock('../../../integrations/search/index.js', () => ({
  createSearchProviderFromEnv: () => ({
    name: 'stub',
    search: vi.fn().mockResolvedValue([]),
  }),
}));

// Spies on the real implementation so the tool it returns (and the name it
// answers to) stays genuine; only the call itself becomes observable.
vi.mock('../../tools/get-business-context.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../tools/get-business-context.js')>();
  return { ...actual, createGetBusinessContextTool: vi.fn(actual.createGetBusinessContextTool) };
});

const { proposeBusinessContextAgent } = await import('./propose-business-context.js');
const { createGetBusinessContextTool } = await import('../../tools/get-business-context.js');

const TENANT = { userId: 'u1', organizationId: 'org-1', workspaceId: 'w1', role: 'MEMBER' as const };
const INPUT = { businessId: '11111111-1111-1111-1111-111111111111' };

function deps(business: unknown) {
  const findFirst = vi.fn().mockResolvedValue(business);
  return { findFirst, deps: { prisma: { business: { findFirst } } as never, tenant: TENANT } };
}

const QUESTION = {
  id: 'mrr',
  ask: 'Quanto a empresa faturou no último mês?',
  why: 'É a base de tudo que a AUREA calcula depois.',
  answerType: 'currency',
  fills: 'currentPerformance.mrr',
  impact: 3,
};

const OK = {
  filled: {
    companyProfile: { mission: 'Ship growth', headquarters: 'São Paulo' },
    marketContext: { tam: 4_000_000_000, maturity: 'growth' },
  },
  questions: [QUESTION],
  confidence: 'MEDIUM',
};

describe('propose-business-context output', () => {
  const schema = proposeBusinessContextAgent.outputSchema;

  it('accepts a proposal that fills some sections and asks about others', () => {
    expect(schema.safeParse(OK).success).toBe(true);
  });

  it('rejects a filled money metric', () => {
    // currentPerformance has no branch in the filled schema at all: four of
    // its fields are derived and eight are founder-only.
    expect(
      schema.safeParse({ ...OK, filled: { ...OK.filled, currentPerformance: { mrr: 45_000 } } }).success,
    ).toBe(false);
  });

  it('rejects a question about a derived field', () => {
    // "What is your ARR?" invites an answer that contradicts mrr x 12.
    expect(
      schema.safeParse({ ...OK, questions: [{ ...QUESTION, fills: 'currentPerformance.arr' }] }).success,
    ).toBe(false);
  });

  it('rejects a question about projects or campaigns', () => {
    expect(
      schema.safeParse({ ...OK, questions: [{ ...QUESTION, fills: 'projects' }] }).success,
    ).toBe(false);
  });

  it('rejects more than six questions', () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({ ...QUESTION, id: `q${i}` }));
    expect(schema.safeParse({ ...OK, questions: seven }).success).toBe(false);
  });

  it('rejects an unknown section in filled', () => {
    expect(schema.safeParse({ ...OK, filled: { ...OK.filled, projects: [] } }).success).toBe(false);
  });
});

describe('propose-business-context precheck', () => {
  it('passes for a business in this workspace', async () => {
    const { deps: d } = deps({ id: INPUT.businessId });
    await expect(proposeBusinessContextAgent.precheck!(INPUT, d)).resolves.toBeUndefined();
  });

  it('refuses a business in another workspace, before any charge', async () => {
    const { deps: d } = deps(null);
    await expect(proposeBusinessContextAgent.precheck!(INPUT, d)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('scopes its lookup to the workspace', async () => {
    const { findFirst, deps: d } = deps({ id: INPUT.businessId });
    await proposeBusinessContextAgent.precheck!(INPUT, d);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: INPUT.businessId, workspaceId: 'w1', deletedAt: null } }),
    );
  });
});

describe('propose-business-context registration', () => {
  it('declares search so the run is refused when search is down', () => {
    expect(proposeBusinessContextAgent.requiresSearch).toBe(true);
    expect(proposeBusinessContextAgent.taskType).toBe('propose-business-context');
    expect(proposeBusinessContextAgent.tier).toBe('TIER2');
  });

  it('budgets room for a seven-section payload and for the time to research it', () => {
    // Os dois tetos que derrubavam este agente em produção. 4096 tokens de
    // saída não cabem `filled` inteiro (seis seções, até doze produtos e oito
    // concorrentes) mais seis perguntas num modelo de raciocínio, que gasta o
    // mesmo teto pensando — o argumento do submit_answer era cortado no meio e
    // o run morria com a mensagem de corte do guardrail. E oito buscas mais as
    // chamadas de correção não terminam nos 180s globais do runner.
    expect(proposeBusinessContextAgent.budget?.maxOutputTokens).toBe(8192);
    expect(proposeBusinessContextAgent.budget?.maxRunMs).toBe(600_000);
  });

  it('reads the stored context and the web, wired to this run\'s own businessId', () => {
    const names = proposeBusinessContextAgent.buildTools(INPUT).map((tool) => tool.name);
    expect(names).toContain('get_business_context');
    expect(names).toContain('web_search');
    // The tool must be built for THIS run's business, never some other value
    // a caller — or attacker-controlled input — could substitute in.
    expect(createGetBusinessContextTool).toHaveBeenCalledWith(INPUT.businessId);
  });
});

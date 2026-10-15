import { describe, expect, it } from 'vitest';
import {
  CONTEXT_FILL_ANSWER_TYPES,
  CONTEXT_FILLS,
  contextFilledSchema,
  isProposableSection,
  PROPOSABLE_SECTIONS,
  SECTION_FIELD,
  SECTION_FILLS,
} from './context-sections.js';

const DERIVED = ['arr', 'cac', 'ltv', 'ltvCacRatio'];

describe('proposable sections', () => {
  it('covers seven of the nine sections', () => {
    expect(PROPOSABLE_SECTIONS).toHaveLength(7);
  });

  it('excludes projects and campaigns', () => {
    // Both are internal record-keeping: a project's name, budget and owner
    // exist nowhere outside the company, so a generator for them would be a
    // button that always returns an empty proposal.
    expect(isProposableSection('projects')).toBe(false);
    expect(isProposableSection('campaigns')).toBe(false);
  });

  it('maps every section to a field that exists in the stored context', () => {
    expect(SECTION_FIELD).toMatchObject({
      company: 'companyProfile',
      products: 'products',
      competitive: 'competitiveLandscape',
      market: 'marketContext',
      constraints: 'constraints',
      performance: 'currentPerformance',
      activities: 'currentActivities',
    });
  });
});

describe('CONTEXT_FILLS', () => {
  it('names no derived field', () => {
    // A model must not be able to ask "what is your ARR?" — that is a number
    // the formula owns, and asking invites an answer contradicting mrr x 12.
    for (const path of CONTEXT_FILLS) {
      const leaf = path.split('.').at(-1);
      expect(DERIVED).not.toContain(leaf);
    }
  });

  it('asks for the founder-only performance numbers', () => {
    expect(CONTEXT_FILLS).toContain('currentPerformance.mrr');
    expect(CONTEXT_FILLS).toContain('currentPerformance.churnRate');
    expect(CONTEXT_FILLS).toContain('currentPerformance.monthlySignups');
    expect(CONTEXT_FILLS).toContain('currentPerformance.activeCustomers');
  });

  it('asks for sam and som but not tam', () => {
    // TAM has public reports behind it. SAM and SOM depend on this company's
    // own reach and channel access — a model estimating them is guessing with
    // a number's authority.
    expect(CONTEXT_FILLS).toContain('marketContext.sam');
    expect(CONTEXT_FILLS).toContain('marketContext.som');
    expect(CONTEXT_FILLS).not.toContain('marketContext.tam');
  });

  it('asks for the spend the CAC formula needs', () => {
    expect(CONTEXT_FILLS).toContain('currentActivities.paidAdvertising.monthlySpend');
  });

  it('holds no duplicate path', () => {
    expect(new Set(CONTEXT_FILLS).size).toBe(CONTEXT_FILLS.length);
  });
});

describe('contextFilledSchema', () => {
  it('accepts the researchable fields', () => {
    const result = contextFilledSchema.safeParse({
      companyProfile: { mission: 'Ship growth', foundedYear: 2021, values: ['speed'] },
      marketContext: { tam: 4_000_000_000, trends: ['AI budgets rising'] },
      competitiveLandscape: { marketPosition: 'challenger' },
      products: [{ name: 'AUREA', description: 'Growth OS' }],
    });
    expect(result.success).toBe(true);
  });

  it('has no currentPerformance branch at all', () => {
    // Every field in that section is founder-only or derived. Omitting the key
    // makes "the model never fills a money metric" structural rather than a
    // rule someone has to remember to check.
    expect(
      contextFilledSchema.safeParse({ currentPerformance: { mrr: 45_000 } }).success,
    ).toBe(false);
  });

  it('rejects a derived field smuggled in anywhere', () => {
    expect(contextFilledSchema.safeParse({ currentPerformance: { arr: 540_000 } }).success).toBe(false);
  });

  it('rejects documentUrls', () => {
    // Uploads. The agent neither proposes a URL the user did not provide nor
    // asks for one in a text box.
    expect(
      contextFilledSchema.safeParse({ companyProfile: { documentUrls: ['https://x.com/a.pdf'] } }).success,
    ).toBe(false);
  });

  it('rejects a product id', () => {
    // Ids are assigned by the client before setValue. A model inventing them
    // produces collisions the form cannot detect.
    expect(
      contextFilledSchema.safeParse({ products: [{ id: 'p1', name: 'A', description: 'B' }] }).success,
    ).toBe(false);
  });

  it('rejects an unknown section', () => {
    expect(contextFilledSchema.safeParse({ projects: [] }).success).toBe(false);
  });
});

describe('SECTION_FILLS', () => {
  it('splits CONTEXT_FILLS by section with the same prefix rule verifySection enforces', () => {
    expect(SECTION_FILLS.market).toEqual(['marketContext.sam', 'marketContext.som']);
    expect(SECTION_FILLS.constraints).toContain('constraints.teamSize');
    expect(SECTION_FILLS.performance).toContain('currentPerformance.mrr');
    expect(SECTION_FILLS.activities).toContain('currentActivities.paidAdvertising.monthlySpend');
  });

  it('is empty for the sections whose fields are all researchable', () => {
    // Não é lacuna: nenhum campo de companyProfile, products ou
    // competitiveLandscape é só-do-fundador. O que isso significa é que uma
    // proposta dessas seções não tem NENHUMA pergunta legal — e o prompt tem
    // que dizer isso, senão o modelo escolhe fills de outra seção e o
    // verifySection reprova até o orçamento acabar.
    expect(SECTION_FILLS.company).toEqual([]);
    expect(SECTION_FILLS.products).toEqual([]);
    expect(SECTION_FILLS.competitive).toEqual([]);
  });

  it('accounts for every entry of CONTEXT_FILLS', () => {
    const partitioned = PROPOSABLE_SECTIONS.flatMap((section) => SECTION_FILLS[section]);
    expect([...partitioned].sort()).toEqual([...CONTEXT_FILLS].sort());
  });
});

describe('CONTEXT_FILL_ANSWER_TYPES', () => {
  it('tipa todo destino perguntável — um fills sem tipo volta a deixar o modelo escolher', () => {
    for (const fill of CONTEXT_FILLS) {
      expect(CONTEXT_FILL_ANSWER_TYPES[fill], fill).toBeDefined();
      expect(CONTEXT_FILL_ANSWER_TYPES[fill]!.length, fill).toBeGreaterThan(0);
    }
  });

  it('não tipa nada que não seja um destino legal', () => {
    for (const fill of Object.keys(CONTEXT_FILL_ANSWER_TYPES)) {
      expect(CONTEXT_FILLS as readonly string[]).toContain(fill);
    }
  });

  it('o único enum é a urgência, e a única data é a baselineDate', () => {
    // O painel monta um select com as `choices` do modelo para `choice`, e data
    // viaja como texto ISO. Todo o resto é número — é o que impede uma resposta
    // string de cair num campo z.int() e reprovar o Salvar da seção.
    const choice = Object.entries(CONTEXT_FILL_ANSWER_TYPES).filter(([, types]) => types.includes('choice'));
    const text = Object.entries(CONTEXT_FILL_ANSWER_TYPES).filter(([, types]) => types.includes('text'));

    expect(choice.map(([fill]) => fill)).toEqual(['constraints.urgency']);
    expect(text.map(([fill]) => fill)).toEqual(['currentPerformance.baselineDate']);
  });
});

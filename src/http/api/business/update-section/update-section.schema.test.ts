import { describe, expect, it } from 'vitest';
import { updateSectionBody } from './update-section.schema.js';

describe('updateSectionBody', () => {
  it('accepts a valid company payload', () => {
    const parsed = updateSectionBody.parse({
      section: 'company',
      data: { mission: 'Democratizar crescimento', values: ['foco'] },
    });
    expect(parsed.section).toBe('company');
  });

  it('rejects a company payload with a wrongly typed field', () => {
    const result = updateSectionBody.safeParse({
      section: 'company',
      data: { foundedYear: 'mil novecentos' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a products payload that is not an array', () => {
    const result = updateSectionBody.safeParse({
      section: 'products',
      data: { name: 'Plano Pro' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a product without the required name', () => {
    const result = updateSectionBody.safeParse({
      section: 'products',
      data: [{ id: 'p1', description: 'sem nome' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown section', () => {
    const result = updateSectionBody.safeParse({ section: 'finance', data: {} });
    expect(result.success).toBe(false);
  });

  it('rejects a company payload with no data key at all', () => {
    const result = updateSectionBody.safeParse({ section: 'company' });
    expect(result.success).toBe(false);
  });

  it('rejects a products payload with no data key at all', () => {
    const result = updateSectionBody.safeParse({ section: 'products' });
    expect(result.success).toBe(false);
  });

  it('rejects a company payload with data explicitly undefined', () => {
    const result = updateSectionBody.safeParse({ section: 'company', data: undefined });
    expect(result.success).toBe(false);
  });

  it('rejects a products payload with data explicitly undefined', () => {
    const result = updateSectionBody.safeParse({ section: 'products', data: undefined });
    expect(result.success).toBe(false);
  });

  it('narrows data by section on the inferred type', () => {
    const parsed = updateSectionBody.parse({
      section: 'products',
      data: [{ id: 'p1', name: 'Pro', description: 'plano' }],
    });
    if (parsed.section === 'products') {
      // Se `data` ainda fosse `unknown`, esta linha não compilaria.
      expect(parsed.data[0]!.name).toBe('Pro');
    }
  });
});

describe('sourceAgentRunId', () => {
  it('is accepted on every section branch', () => {
    const runId = '55555555-5555-5555-5555-555555555555';
    for (const section of ['company', 'market', 'performance', 'projects', 'campaigns'] as const) {
      const data = ['projects', 'campaigns', 'products'].includes(section) ? [] : {};
      expect(updateSectionBody.safeParse({ section, data, sourceAgentRunId: runId }).success).toBe(true);
    }
  });

  it('stays optional', () => {
    expect(updateSectionBody.safeParse({ section: 'market', data: {} }).success).toBe(true);
  });

  it('rejects a value that is not a uuid', () => {
    // It is written into a foreign-key column; a free string would be stored
    // as provenance pointing at nothing.
    expect(
      updateSectionBody.safeParse({ section: 'market', data: {}, sourceAgentRunId: 'not-a-run' }).success,
    ).toBe(false);
  });
});

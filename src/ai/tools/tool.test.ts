import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseToolArgs, toToolSpec, type Tool } from './tool.js';

const tool: Tool<{ sections?: string[] }> = {
  name: 'get_business_context',
  description: 'Reads the stored business context',
  argsSchema: z.object({ sections: z.array(z.string()).optional() }),
  async execute() {
    return { ok: true };
  },
};

describe('tool', () => {
  it('derives a JSON Schema for the wire from the Zod args schema', () => {
    const spec = toToolSpec(tool as Tool<never>);
    expect(spec.name).toBe('get_business_context');
    expect(spec.description).toBe('Reads the stored business context');
    expect(spec.parameters).toMatchObject({ type: 'object' });
  });

  it('accepts valid args', () => {
    const result = parseToolArgs(tool, { sections: ['company'] });
    expect(result.ok).toBe(true);
  });

  it('turns invalid args into feedback for the model instead of throwing', () => {
    const result = parseToolArgs(tool, { sections: 'company' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.feedback).toContain('sections');
  });

  it('reports the unparseable-arguments marker produced by the provider', () => {
    const result = parseToolArgs(tool, { __unparseableArguments: '{not json' });
    expect(result.ok).toBe(false);
  });
});

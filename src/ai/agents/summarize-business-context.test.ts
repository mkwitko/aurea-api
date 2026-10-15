import { describe, expect, it } from 'vitest';
import { getAgent } from './registry.js';
import { summarizeBusinessContextAgent } from './summarize-business-context.js';

const tenant = { userId: 'u1', organizationId: 'o1', workspaceId: 'ws-1', role: 'OWNER' as const };

describe('summarize-business-context agent', () => {
  it('is reachable through the registry by taskType', () => {
    expect(getAgent('summarize-business-context')).toBe(summarizeBusinessContextAgent);
  });

  it('returns undefined for an unknown taskType', () => {
    expect(getAgent('nope')).toBeUndefined();
  });

  it('requires a businessId in the input', () => {
    expect(summarizeBusinessContextAgent.inputSchema.safeParse({}).success).toBe(false);
    expect(
      summarizeBusinessContextAgent.inputSchema.safeParse({ businessId: '3f1e8f6e-1f1a-4f0e-9b0e-0f6d3b7a1c22' })
        .success,
    ).toBe(true);
  });

  it('exposes exactly the context tool, bound to the run business', () => {
    const tools = summarizeBusinessContextAgent.buildTools({ businessId: 'b-1' });
    expect(tools.map((t) => t.name)).toEqual(['get_business_context']);
  });

  it('tells the model how a run ends, now that submit_answer replaces json mode', () => {
    const text = summarizeBusinessContextAgent
      .buildMessages({ businessId: 'b-1' }, { tenant })
      .map((m) => ('content' in m ? m.content : ''))
      .join('\n');
    expect(text).toContain('submit_answer');
  });

  it('tells the model that retrieved content is data, not instructions', () => {
    const system = summarizeBusinessContextAgent.buildMessages({ businessId: 'b-1' }, { tenant })[0]!;
    expect('content' in system ? system.content : '').toMatch(/not instructions/i);
  });

  it('accepts a well-formed output and rejects a short risk list', () => {
    const good = { summary: 'ok', risks: ['a', 'b', 'c'], confidence: 'MEDIUM' };
    expect(summarizeBusinessContextAgent.outputSchema.safeParse(good).success).toBe(true);
    expect(
      summarizeBusinessContextAgent.outputSchema.safeParse({ ...good, risks: ['a'] }).success,
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildSubmitToolSpec, SUBMIT_TOOL_NAME } from './submit-answer.js';

describe('buildSubmitToolSpec', () => {
  const schema = z
    .object({
      summary: z.string().min(1).max(400),
      confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    })
    .strict();

  it('names the tool submit_answer', () => {
    expect(buildSubmitToolSpec(schema).name).toBe(SUBMIT_TOOL_NAME);
    expect(SUBMIT_TOOL_NAME).toBe('submit_answer');
  });

  it('derives the parameters from the zod schema, enums included', () => {
    const parameters = buildSubmitToolSpec(schema).parameters as Record<string, any>;
    expect(parameters.type).toBe('object');
    expect(Object.keys(parameters.properties)).toEqual(['summary', 'confidence']);
    expect(parameters.properties.confidence.enum).toEqual(['LOW', 'MEDIUM', 'HIGH']);
    expect(parameters.required).toEqual(['summary', 'confidence']);
  });

  it('forbids extra keys, because .strict() is what stops the model inventing fields', () => {
    const parameters = buildSubmitToolSpec(schema).parameters as Record<string, any>;
    expect(parameters.additionalProperties).toBe(false);
  });

  it('emits a self-contained schema with no $ref indirection', () => {
    // DeepSeek e compatíveis não resolvem $ref/definitions em parameters de
    // tool: um schema com referência chega ao modelo como objeto vazio.
    const json = JSON.stringify(buildSubmitToolSpec(schema).parameters);
    expect(json).not.toContain('$ref');
    expect(json).not.toContain('definitions');
  });

  it('describes the tool so the model knows it is how a run ends', () => {
    expect(buildSubmitToolSpec(schema).description.toLowerCase()).toContain('final');
  });

  it('emits numeric exclusive bounds, because a boolean one is rejected by the provider', () => {
    // O alvo openApi3 escreve exclusiveMinimum no estilo draft-4 (`true`, ao
    // lado de `minimum`). O validador de function schema do provider é
    // draft-07+, onde a chave é um número: um `.positive()` no outputSchema
    // derrubava o run inteiro com
    // "Invalid schema for function 'submit_answer': true is not of type number".
    const bounded = z.object({
      tam: z.number().positive().optional(),
      loss: z.number().negative().optional(),
      floor: z.number().nonnegative().optional(),
    });
    const parameters = buildSubmitToolSpec(bounded).parameters as Record<string, any>;

    expect(parameters.properties.tam.exclusiveMinimum).toBe(0);
    expect(parameters.properties.tam.minimum).toBeUndefined();
    expect(parameters.properties.loss.exclusiveMaximum).toBe(0);
    expect(parameters.properties.loss.maximum).toBeUndefined();
    // Limite inclusivo continua sendo minimum — não há nada a converter.
    expect(parameters.properties.floor.minimum).toBe(0);
  });

  it('converts exclusive bounds nested inside objects and arrays', () => {
    const nested = z.object({
      market: z.object({ tam: z.number().positive() }),
      sizes: z.array(z.number().positive()),
    });
    const json = JSON.stringify(buildSubmitToolSpec(nested).parameters);

    expect(json).not.toContain('"exclusiveMinimum":true');
    expect(json).not.toContain('"exclusiveMaximum":true');
  });
});

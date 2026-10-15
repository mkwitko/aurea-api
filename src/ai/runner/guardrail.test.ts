import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { validateArgs, validateOutput } from './guardrail.js';

const schema = z.object({ summary: z.string().min(1), risks: z.array(z.string()).length(3) });

describe('validateOutput', () => {
  it('accepts valid JSON', () => {
    const result = validateOutput(schema, JSON.stringify({ summary: 'ok', risks: ['a', 'b', 'c'] }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.summary).toBe('ok');
  });

  it('unwraps a fenced json block', () => {
    const text = '```json\n{"summary":"ok","risks":["a","b","c"]}\n```';
    expect(validateOutput(schema, text).ok).toBe(true);
  });

  it('reports empty content, which DeepSeek can return in json mode', () => {
    const result = validateOutput(schema, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.feedback).toMatch(/empty/i);
  });

  it('reports malformed JSON', () => {
    const result = validateOutput(schema, '{not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.feedback).toMatch(/valid JSON/i);
  });

  it('lists every schema violation with its path', () => {
    const result = validateOutput(schema, JSON.stringify({ summary: '', risks: ['a'] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.feedback).toContain('summary');
      expect(result.feedback).toContain('risks');
    }
  });
});

describe('validateArgs', () => {
  const schema = z.object({ summary: z.string().min(1), score: z.number() }).strict();

  it('accepts an object that matches the schema', () => {
    const result = validateArgs(schema, { summary: 'ok', score: 1 });
    expect(result).toEqual({ ok: true, value: { summary: 'ok', score: 1 } });
  });

  it('reports the offending paths when the object does not match', () => {
    const result = validateArgs(schema, { summary: '', score: 'x' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a rejection');
    expect(result.feedback).toContain('summary');
    expect(result.feedback).toContain('score');
    expect(result.feedback).toContain('submit_answer');
  });

  it('rejects the unparseable-arguments marker with the raw text in the feedback', () => {
    const result = validateArgs(schema, { __unparseableArguments: '{"summary": ' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a rejection');
    expect(result.feedback).toContain('{"summary": ');
  });

  it('rejects a non-object', () => {
    expect(validateArgs(schema, 'nope').ok).toBe(false);
  });

  it('tells a truncated call to shorten, not to fix its syntax', () => {
    // Um modelo de raciocínio pode gastar o teto inteiro de saída antes de
    // terminar os argumentos. Mandá-lo "corrigir o JSON" faz ele reenviar uma
    // resposta do mesmo tamanho, que é cortada de novo — o laço só converge se
    // o feedback disser que o problema é o tamanho.
    const result = validateArgs(schema, { __unparseableArguments: '{"summary": ' }, { truncated: true });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a rejection');
    expect(result.feedback).toContain('cut off');
    expect(result.feedback).toContain('shorter');
    expect(result.feedback).not.toContain('not valid JSON');
  });

  it('points a truncated call at the whole payload, not only at its questions', () => {
    // O que estoura o teto num agente de preenchimento é `filled` — sete
    // seções, doze produtos, oito concorrentes. Um feedback que só manda cortar
    // perguntas faz o modelo encurtar a parte pequena e ser cortado de novo no
    // mesmo lugar.
    const result = validateArgs(schema, { __unparseableArguments: '{"summary": ' }, { truncated: true });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a rejection');
    expect(result.feedback).toContain('optional');
    expect(result.feedback).toContain('list');
    expect(result.feedback).not.toContain('fewer questions');
  });

  it('does not echo a long truncated payload back to the model', () => {
    const huge = `{"summary": "${'x'.repeat(4000)}`;
    const result = validateArgs(schema, { __unparseableArguments: huge });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a rejection');
    // O eco existe para o modelo localizar o erro; a resposta inteira de volta
    // no prompt é o que dobrou os tokens de entrada entre uma tentativa e a
    // seguinte, sem dizer nada que as primeiras linhas já não digam.
    expect(result.feedback.length).toBeLessThan(1000);
  });
});

import type { ZodType } from 'zod';
import { buildSubmitToolSpec } from './submit-answer.js';

/**
 * Teto do crescimento do teto de saída.
 *
 * Um argumento cortado só converge se a tentativa seguinte tiver mais espaço;
 * pedir um max_tokens acima do que o provider aceita trocaria uma tentativa
 * perdida pelo run inteiro, então o dobro para de dobrar aqui.
 */
export const OUTPUT_TOKEN_CEILING = 16_384;

/** Quando o agente não declara teto próprio. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 2048;

/**
 * Caracteres por token na saída destes agentes: JSON com muita pontuação e
 * texto em português, os dois piores que a média de 4 do inglês corrido.
 */
const CHARS_PER_TOKEN = 3.2;

/** Margem sobre a estimativa: reasoning tokens do modelo contam como saída. */
const MARGIN = 1.25;

/** Comprimento assumido quando o schema não põe teto. Sem isto a conta mente. */
const UNBOUNDED_STRING = 400;
const UNBOUNDED_ARRAY = 6;
/** `-1234567890.12345` com folga. */
const NUMBER_CHARS = 20;

/**
 * O maior payload que um schema de saída ACEITA, em tokens.
 *
 * Existe porque `maxOutputTokens` era constante escolhida a dedo, e a conta que
 * a justificava vivia num comentário. O `propose-icp` aceitava uma descrição de
 * 2000 caracteres mais cinco listas de seis itens de 200 — 2400 tokens — com
 * teto de 2048: o `submit_answer` saía cortado, e o run terminava sem ICP com o
 * crédito estornado (run ebf8e706).
 *
 * A estimativa é de propósito grosseira e sempre por cima: ela decide um teto,
 * e teto grande não custa nada — o provider cobra os tokens gerados, não os
 * autorizados. O que custa é o teto pequeno, que joga fora a resposta inteira.
 */
export function estimateWorstCaseOutputTokens(schema: ZodType<unknown>): number {
  const jsonSchema = buildSubmitToolSpec(schema).parameters;
  const chars = worstCaseChars(jsonSchema);
  return Math.ceil(((chars / CHARS_PER_TOKEN) * MARGIN) / 64) * 64;
}

function worstCaseChars(node: unknown): number {
  if (node === null || typeof node !== 'object') return 0;
  const schema = node as Record<string, unknown>;

  // Uniões (anyOf/oneOf) valem o pior ramo: o modelo escolhe um.
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const branches = schema[key];
    if (Array.isArray(branches)) {
      const sizes = branches.map(worstCaseChars);
      return key === 'allOf' ? sizes.reduce((a, b) => a + b, 0) : Math.max(0, ...sizes);
    }
  }

  if (Array.isArray(schema.enum)) {
    const longest = Math.max(0, ...schema.enum.map((value) => String(value).length));
    return longest + 2;
  }

  switch (schema.type) {
    case 'string': {
      const max = typeof schema.maxLength === 'number' ? schema.maxLength : UNBOUNDED_STRING;
      // +2 pelas aspas, e uma folga de 10% por escape (`\"`, `\n`, acentos em
      // \u): um texto todo escapado é mais longo do que os caracteres que tem.
      return Math.ceil((max + 2) * 1.1);
    }
    case 'number':
    case 'integer':
      return NUMBER_CHARS;
    case 'boolean':
      return 5;
    case 'array': {
      const items = typeof schema.maxItems === 'number' ? schema.maxItems : UNBOUNDED_ARRAY;
      // +1 por vírgula entre itens, +2 pelos colchetes.
      return items * (worstCaseChars(schema.items) + 1) + 2;
    }
    case 'object':
    default: {
      const properties = schema.properties;
      if (typeof properties !== 'object' || properties === null) return UNBOUNDED_STRING;
      return (
        Object.entries(properties as Record<string, unknown>).reduce(
          // `"chave":` mais a vírgula.
          (total, [key, value]) => total + key.length + 4 + worstCaseChars(value),
          0,
        ) + 2
      );
    }
  }
}

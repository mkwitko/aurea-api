import type { ZodType } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { AiToolSpec } from '../providers/provider.js';

export const SUBMIT_TOOL_NAME = 'submit_answer';

/**
 * O contrato de saída do agente vira uma tool em vez de um trecho de prompt.
 *
 * DeepSeek não tem `response_format: {"type":"json_schema"}` — só
 * `json_object`, que garante JSON válido e nada sobre a forma. A única
 * imposição de schema que o provider oferece é o `parameters` de uma tool, e é
 * essa a razão de `submit_answer` existir: o mesmo Zod que valida a volta
 * descreve a ida, e o modelo não recebe mais a forma como prosa que ele pode
 * ler errado.
 *
 * `$refStrategy: 'none'` não é preferência de estilo: um `$ref` no parameters
 * chega ao modelo como objeto vazio, porque o servidor não resolve
 * `definitions`. Schema recursivo estouraria aqui — nenhum outputSchema de
 * agente é recursivo, e um que fosse precisa ser reescrito, não referenciado.
 */
export function buildSubmitToolSpec(schema: ZodType<unknown>): AiToolSpec {
  return {
    name: SUBMIT_TOOL_NAME,
    description:
      'Submit your final answer. Call this exactly once, when you have everything you need. ' +
      'The arguments are the complete result — there is no other way to finish.',
    parameters: withNumericExclusiveBounds(
      zodToJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' }),
    ) as ReturnType<typeof zodToJsonSchema>,
  };
}

/**
 * Reescreve limites exclusivos do estilo OpenAPI 3.0 para o do JSON Schema.
 *
 * O alvo `openApi3` emite draft-4: `{ minimum: 0, exclusiveMinimum: true }`. O
 * validador de function schema do provider é draft-07+, onde `exclusiveMinimum`
 * é o próprio número — e um booleano ali derruba a requisição inteira com
 * `Invalid schema for function 'submit_answer': true is not of type "number"`,
 * antes de qualquer token ser gerado.
 *
 * A conversão mora aqui, e não no schema do agente, porque o defeito é da
 * tradução para o provider: trocar um `.positive()` por `.min(1)` conserta um
 * campo e deixa a próxima ocorrência quebrar um run já cobrado.
 */
function withNumericExclusiveBounds(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withNumericExclusiveBounds);
  if (node === null || typeof node !== 'object') return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    out[key] = withNumericExclusiveBounds(value);
  }

  for (const [flag, bound] of [
    ['exclusiveMinimum', 'minimum'],
    ['exclusiveMaximum', 'maximum'],
  ] as const) {
    if (out[flag] === true && typeof out[bound] === 'number') {
      out[flag] = out[bound];
      delete out[bound];
    } else if (typeof out[flag] === 'boolean') {
      // `false` é o padrão draft-4 e não diz nada; sem o par numérico, um
      // booleano solto só serviria para o provider recusar o schema.
      delete out[flag];
    }
  }

  return out;
}

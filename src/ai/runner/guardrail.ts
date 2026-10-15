import type { ZodType } from 'zod';

export type GuardrailResult<O> = { ok: true; value: O } | { ok: false; feedback: string };

const FENCE = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i;

function stripFence(text: string): string {
  const match = FENCE.exec(text);
  return match ? match[1]! : text;
}

export function validateOutput<O>(schema: ZodType<O>, text: string | null): GuardrailResult<O> {
  if (text === null || text.trim() === '') {
    return { ok: false, feedback: 'Your previous answer was empty. Reply with the JSON object only.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(text));
  } catch {
    // Log da resposta crua que o modelo devolveu — essencial para diagnosticar
    // por que o JSON.parse falhou (reasoning_content, prosa, fence malformada, etc.)
    console.error(
      '[guardrail] JSON parse failed',
      JSON.stringify({ textLength: text.length, preview: text.slice(0, 500), full: text.slice(0, 3000) }),
    );
    return {
      ok: false,
      feedback: 'Your previous answer was not valid JSON. Reply with a single JSON object, no prose, no code fence.',
    };
  }

  const result = schema.safeParse(parsed);
  if (result.success) return { ok: true, value: result.data };

  return {
    ok: false,
    feedback: `Your previous answer did not match the required schema:\n${describeIssues(result.error)}\nReply with a corrected JSON object only.`,
  };
}

/**
 * Devolver a resposta inteira no feedback dobra os tokens de entrada da
 * chamada seguinte e não diz nada que o começo já não diga — o modelo precisa
 * reconhecer o que escreveu, não relê-lo.
 */
const FEEDBACK_ECHO_LIMIT = 400;

function truncateForFeedback(raw: string): string {
  return raw.length <= FEEDBACK_ECHO_LIMIT ? raw : `${raw.slice(0, FEEDBACK_ECHO_LIMIT)}… (cut here, ${raw.length} characters in all)`;
}

function describeIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues.map((issue) => `- ${issue.path.join('.') || '(root)'}: ${issue.message}`).join('\n');
}

/**
 * A validação do caminho de tool: os argumentos já vieram como objeto do
 * provider, então não há JSON para parsear — só forma para conferir. O
 * feedback fala em `submit_answer` de propósito: ele volta para o modelo como
 * resultado da própria tool, e a instrução tem que dizer o que chamar de novo.
 */
export function validateArgs<O>(
  schema: ZodType<O>,
  args: unknown,
  options: { truncated?: boolean } = {},
): GuardrailResult<O> {
  if (typeof args === 'object' && args !== null && '__unparseableArguments' in args) {
    const raw = String((args as Record<string, unknown>).__unparseableArguments);

    // Argumento cortado pelo teto de saída não é erro de sintaxe, e tratar como
    // se fosse é o que trava o run: o modelo reenvia uma resposta do mesmo
    // tamanho, ela é cortada no mesmo lugar, e as iterações acabam. A saída é
    // encolher a resposta, então é isso que o feedback pede.
    if (options.truncated) {
      return {
        ok: false,
        feedback:
          'Your submit_answer call was cut off by the output token limit before the arguments were complete. ' +
          'The JSON was not wrong, only unfinished — sending it again the same size will be cut off again. ' +
          'Call submit_answer with a shorter result: keep only the fields you have real evidence for, ' +
          'leave out every optional field you are unsure about, cut each list to its few strongest items, ' +
          'and keep every sentence to one line.',
      };
    }

    return {
      ok: false,
      feedback:
        `Your submit_answer arguments were not valid JSON. It started with: ${truncateForFeedback(raw)}. ` +
        'Call submit_answer again with well-formed arguments.',
    };
  }

  const result = schema.safeParse(args);
  if (result.success) return { ok: true, value: result.data };

  return {
    ok: false,
    feedback: `Your submit_answer arguments did not match the required schema:\n${describeIssues(
      result.error,
    )}\nCall submit_answer again with corrected arguments.`,
  };
}

// Traces leave our infrastructure, and messages/tool results can carry the
// founder's business data — plus, incidentally, whatever a tool happened to
// return (provider credentials, sealed-secret internals). This is the one
// place all of that passes through before it reaches Langfuse.

// 2000 caracteres cortavam o prompt de sistema de um agente de preenchimento
// no meio — justamente o campo pelo qual se abre uma trace quando a resposta
// veio errada. O teto continua existindo para um tool result patológico não
// virar um payload de megabytes, não para esconder o que mandamos ao modelo.
const MAX_STRING_CHARS = 40_000;
const MAX_ARRAY_ITEMS = 100;
const MAX_DEPTH = 8;

// Matches key names for: API keys/tokens/secrets/passwords/auth headers,
// and the SealedSecret shape from billing/crypto.ts (ciphertext/iv/authTag).
const SENSITIVE_KEY = /(api[-_]?key|secret|password|token|authoriz|credential|ciphertext|authtag|^iv$)/i;

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return value.length > MAX_STRING_CHARS
      ? `${value.slice(0, MAX_STRING_CHARS)}…[truncated ${value.length - MAX_STRING_CHARS} chars]`
      : value;
  }

  if (typeof value !== 'object') return value; // number, boolean, bigint, function (dropped by JSON anyway)

  if (depth >= MAX_DEPTH) return '[max depth reached]';

  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => redact(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) items.push(`…[${value.length - MAX_ARRAY_ITEMS} more items]`);
    return items;
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redact(val, depth + 1);
  }
  return out;
}

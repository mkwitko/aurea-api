import type { PrismaClient } from '@prisma/client';
import type { ZodType } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { AiToolSpec } from '../providers/provider.js';
import type { TenantContext } from '../../lib/tenant.js';

// signal é o sinal de vida do run inteiro (cancelado no timeout do runner ou
// se o run for abandonado); cada tool decide se e como observá-lo.
export type ToolContext = { tenant: TenantContext; prisma: PrismaClient; signal: AbortSignal };

export type Tool<A = unknown> = {
  name: string;
  description: string;
  argsSchema: ZodType<A>;
  execute(args: A, ctx: ToolContext): Promise<unknown>;
};

// O JSON Schema mandado ao modelo é derivado do mesmo Zod que valida a volta.
// Declarar os dois à mão é como schemas divergem sem ninguém notar.
export function toToolSpec(tool: Tool<never>): AiToolSpec {
  return {
    name: tool.name,
    description: tool.description,
    parameters: zodToJsonSchema(tool.argsSchema, { target: 'openApi3' }),
  };
}

export function parseToolArgs<A>(
  tool: Tool<A>,
  args: unknown,
): { ok: true; value: A } | { ok: false; feedback: string } {
  // Check for the unparseable-arguments marker from the provider
  if (
    typeof args === 'object' &&
    args !== null &&
    '__unparseableArguments' in args
  ) {
    return {
      ok: false,
      feedback: `Invalid arguments for ${tool.name} — could not parse JSON: ${(args as Record<string, unknown>).__unparseableArguments}`,
    };
  }

  const result = tool.argsSchema.safeParse(args);
  if (result.success) return { ok: true, value: result.data };

  const problems = result.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');

  return { ok: false, feedback: `Invalid arguments for ${tool.name} — ${problems}` };
}

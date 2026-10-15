import { z } from 'zod';
import type { Tool, ToolContext } from './tool.js';

const argsSchema = z.object({
  sections: z
    .array(z.string())
    .optional()
    .describe('Optional list of context section keys to return. Omit to get everything.'),
});

type Args = z.infer<typeof argsSchema>;

/**
 * Os campos do próprio Business que acompanham o contexto.
 *
 * Antes só o nome atravessava, e era um descarte caro: um negócio recém-criado
 * tem `description`, `valueProposition` e `positioning` escritos pelo fundador
 * e nenhuma BusinessContextVersion ainda. Sem eles a tool respondia
 * `{ businessName, context: {} }` a uma pergunta sobre a seção company, e o
 * agente — que não tem busca web — não tinha de onde tirar missão, visão,
 * valores ou tom de marca. São palavras do próprio fundador, o mesmo nível de
 * confiança do nome, não conteúdo raspado da web.
 */
const PROFILE_FIELDS = [
  'name',
  'description',
  'website',
  'industry',
  'businessModel',
  'revenueModel',
  'valueProposition',
  'positioning',
] as const;

function toProfile(business: Record<string, unknown>): Record<string, unknown> {
  const profile: Record<string, unknown> = {};
  for (const field of PROFILE_FIELDS) {
    // Campo em branco sai da resposta em vez de virar null: ausência já diz
    // "não sabemos", e um null é algo que o modelo tenta reproduzir.
    const value = business[field];
    if (value !== null && value !== undefined && value !== '') profile[field] = value;
  }
  return profile;
}

// O businessId vem do input do run, nunca dos argumentos do modelo: conteúdo
// injetado no contexto não pode pedir dados de outro business.
export function createGetBusinessContextTool(businessId: string): Tool<Args> {
  return {
    name: 'get_business_context',
    description:
      'Returns the business profile the founder wrote and the stored business context for the business ' +
      'under analysis. Call this before answering.',
    argsSchema,
    async execute(args: Args, ctx: ToolContext) {
      const business = await ctx.prisma.business.findFirst({
        where: { id: businessId, workspaceId: ctx.tenant.workspaceId, deletedAt: null },
      });
      if (!business) return { error: 'business not found in this workspace' };

      const profile = toProfile(business as unknown as Record<string, unknown>);

      const context = await ctx.prisma.businessContext.findUnique({
        where: { businessId },
        include: { currentVersion: true },
      });

      // Narrowing of a Prisma JSON column, not unvalidated external input
      const data = (context?.currentVersion?.data ?? {}) as Record<string, unknown>;
      // `sections` filtra o contexto salvo, nunca o perfil: o perfil é o que
      // fundamenta qualquer seção, e escondê-lo atrás do filtro reintroduziria
      // a resposta vazia que este campo existe para acabar.
      if (!args.sections?.length) {
        return { businessName: business.name, business: profile, context: data };
      }

      const filtered: Record<string, unknown> = {};
      for (const key of args.sections) {
        if (key in data) filtered[key] = data[key];
      }
      return { businessName: business.name, business: profile, context: filtered };
    },
  };
}

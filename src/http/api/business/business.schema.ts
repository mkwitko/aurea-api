import { z } from 'zod';

export const businessSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  website: z.string().nullable(),
  industry: z.string().nullable(),
  businessModel: z.string().nullable(),
  revenueModel: z.string().nullable(),
  valueProposition: z.string().nullable(),
  positioning: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const contextSectionSchema = z.enum([
  'company',
  'products',
  'competitive',
  'market',
  'constraints',
  'performance',
  'activities',
  'projects',
  'campaigns',
]);

// Compartilhado entre o `source`/`confidence` da versão inteira e a
// proveniência por seção em `sectionMeta` — as duas descrevem a mesma coisa
// (quem escreveu, quão confiável) em granularidades diferentes.
export const contextSourceSchema = z.enum(['USER', 'RESEARCH', 'INTEGRATION', 'AI', 'SYSTEM']);
export const contextConfidenceSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'VERIFIED']);

/**
 * Proveniência de UMA seção do contexto (chave = nome do campo em `data`,
 * como `companyProfile` ou `marketContext`, não o `section` curto da rota de
 * update-section). É o que o painel lê para desenhar o selo "proposto pela IA"
 * e para decidir, do lado do cliente, se uma seção ainda é candidata a
 * proposta automática — a decisão que realmente vale (se uma nova proposta
 * PODE sobrescrever) é sempre revalidada no servidor, em
 * propose-business-context.apply.ts.
 */
export const sectionMetaEntrySchema = z.object({
  source: contextSourceSchema,
  sourceAgentRunId: z.string().nullable().optional(),
  confidence: contextConfidenceSchema.optional(),
});
export const sectionMetaSchema = z.record(z.string(), sectionMetaEntrySchema);
export type SectionMetaEntry = z.infer<typeof sectionMetaEntrySchema>;
export type SectionMeta = z.infer<typeof sectionMetaSchema>;

export const contextVersionSchema = z.object({
  id: z.string().uuid(),
  version: z.number(),
  data: z.record(z.string(), z.unknown()),
  source: contextSourceSchema,
  confidence: contextConfidenceSchema,
  // Id do AgentRun que originou esta versão, quando ela veio de pesquisa. É a
  // única volta possível do valor gravado (uma string em marketContext.trends,
  // por exemplo) para a citação e a url que o justificaram — o run guarda os
  // achados inteiros. Nulo em toda versão escrita por humano ou integração.
  // Não é uuid() de propósito: é um id recordado, sem FK, e um formato
  // inesperado no banco não pode derrubar a serialização da resposta.
  sourceAgentRunId: z.string().nullable(),
  createdAt: z.date(),
  completeness: z.number(),
  incompleteSections: z.array(contextSectionSchema),
  // Proveniência por seção. `{}` (nunca escrita, ou versão anterior a este
  // campo) significa "nenhuma seção carrega selo" — o painel trata a ausência
  // de entrada exatamente como trataria `source: 'USER'`.
  sectionMeta: sectionMetaSchema.default({}),
});

export const businessResponse = z.object({ business: businessSchema.nullable() });
export const businessCreatedResponse = z.object({ business: businessSchema });
export const contextResponse = z.object({ currentVersion: contextVersionSchema.nullable() });
export const contextVersionResponse = z.object({ version: contextVersionSchema });

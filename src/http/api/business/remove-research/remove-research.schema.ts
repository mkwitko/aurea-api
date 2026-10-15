import { z } from 'zod';
import { contextVersionSchema } from '../business.schema.js';

// Mesma carga do aceite, mesma razão: índices, não textos. O servidor relê o
// output do run e decide o que cada índice significa.
export const removeResearchBody = z
  .object({
    agentRunId: z.string().uuid(),
    findingIndexes: z.array(z.number().int().min(0)).max(8).default([]),
    opportunityIndexes: z.array(z.number().int().min(0)).max(3).default([]),
  })
  .refine((value) => value.findingIndexes.length + value.opportunityIndexes.length > 0, {
    message: 'Select at least one finding or opportunity',
    path: ['findingIndexes'],
  });

export type RemoveResearchBody = z.infer<typeof removeResearchBody>;

/**
 * `version` é nula quando não havia contexto nenhum para mexer — remover de um
 * contexto vazio não cria uma versão para representar a ausência.
 */
export const removeResearchResponse = z.object({
  version: contextVersionSchema.nullable(),
  created: z.boolean(),
  skippedFindingIndexes: z.array(z.number().int()),
  skippedOpportunityIndexes: z.array(z.number().int()),
});

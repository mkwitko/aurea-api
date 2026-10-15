import { z } from 'zod';
import { contextVersionSchema } from '../business.schema.js';

// O corpo não carrega achados: o servidor relê o output gravado do run, para
// que o browser não possa alegar que o agente encontrou algo que ele não
// encontrou.
export const fromResearchBody = z
  .object({
    agentRunId: z.string().uuid(),
    findingIndexes: z.array(z.number().int().min(0)).max(8).default([]),
    opportunityIndexes: z.array(z.number().int().min(0)).max(3).default([]),
  })
  .refine((value) => value.findingIndexes.length + value.opportunityIndexes.length > 0, {
    message: 'Select at least one finding or opportunity',
    path: ['findingIndexes'],
  });

export type FromResearchBody = z.infer<typeof fromResearchBody>;

/**
 * A resposta diz o que aconteceu, não só que algo aconteceu: `created` false
 * significa que nada foi gravado porque tudo que veio selecionado já estava no
 * contexto, e os índices ignorados dizem quais. Sem isso a tela só podia
 * afirmar "salvo" e esperar que fosse verdade.
 */
export const fromResearchResponse = z.object({
  version: contextVersionSchema,
  created: z.boolean(),
  skippedFindingIndexes: z.array(z.number().int()),
  skippedOpportunityIndexes: z.array(z.number().int()),
});

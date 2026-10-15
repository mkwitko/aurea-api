import { z } from 'zod';

export const researchPresenceParams = z.object({ agentRunId: z.string().uuid() });

export type ResearchPresenceParams = z.infer<typeof researchPresenceParams>;

/**
 * Índices deste run que já estão no contexto atual. Índices, não textos: é a
 * mesma moeda que o aceite e a remoção usam, então a tela marca, guarda e
 * remove falando sempre a mesma língua.
 */
export const researchPresenceResponse = z.object({
  presentFindingIndexes: z.array(z.number().int()),
  presentOpportunityIndexes: z.array(z.number().int()),
});

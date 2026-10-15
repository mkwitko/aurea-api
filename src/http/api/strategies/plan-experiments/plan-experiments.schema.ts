import { z } from 'zod';

export const planExperimentsParams = z.object({ id: z.string().uuid() });

/**
 * Resultado por hipótese, não um número só.
 *
 * Um lote de nove pedidos pode ter um recusado por crédito e outro por já ter
 * um run em voo, e um "5 de 9" sem dizer quais deixa a tela sem como oferecer
 * retry do que faltou.
 */
export const planExperimentsResponse = z.object({
  runs: z.array(z.object({ hypothesisId: z.string().uuid(), agentRunId: z.string().uuid() })),
  failed: z.array(z.object({ hypothesisId: z.string().uuid(), reason: z.string() })),
});

import { z } from 'zod';

export const proposalUsageQuery = z.object({ agentRunId: z.string().uuid() });

/**
 * Quais opções desta proposta já viraram estratégia.
 *
 * O deck precisa disto para não oferecer uma opção que o servidor vai recusar:
 * a recuperação da tela adota o run mais novo mesmo depois de COMPLETED, então
 * sem esta resposta o fundador vê para sempre opções que já gastou.
 */
export const proposalUsageResponse = z.object({ usedOptionIndexes: z.array(z.number().int().nonnegative()) });

export type ProposalUsageQuery = z.infer<typeof proposalUsageQuery>;

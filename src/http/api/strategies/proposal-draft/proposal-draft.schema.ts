import { z } from 'zod';
import { strategyDraftBody } from '../create-from-proposal/create-from-proposal.schema.js';

export const proposalDraftParams = z.object({ agentRunId: z.string().uuid() });

// Lista separada por vírgula em vez de chave repetida: é um parâmetro de query
// que o cliente gerado monta como uma string só, e a forma é validada aqui —
// nada de `Number('abc')` virando NaN dentro do serviço.
export const proposalDraftQuery = z.object({
  optionIndexes: z
    .string()
    .regex(/^\d+(,\d+)*$/, 'optionIndexes must be a comma-separated list of indexes')
    .transform((value) => value.split(',').map(Number)),
});

/**
 * O plano que sairia da combinação pedida, antes de existir.
 *
 * Existe para que a fusão tenha uma implementação só: a tela precisa mostrar o
 * texto combinado num formulário editável, e recalculá-lo no browser seria uma
 * segunda regra livre para divergir desta — a que grava.
 */
export const proposalDraftResponse = z.object({ strategy: strategyDraftBody });

export type ProposalDraftParams = z.infer<typeof proposalDraftParams>;
export type ProposalDraftQuery = z.infer<typeof proposalDraftQuery>;

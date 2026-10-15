import { z } from 'zod';

// Os limites são os das colunas de Strategy/Hypothesis (ver
// create-strategy.schema.ts e o outputSchema do propose-strategies): o texto
// editado pelo fundador passa pelo mesmo crivo que o texto do agente, porque é
// a mesma coluna que recebe os dois.
const hypothesisDraft = z.object({
  statement: z.string().min(1).max(500),
  rationale: z.string().min(1).max(1000),
  targetMetric: z.string().min(1).max(160),
  expectedOutcome: z.string().min(1).max(1000),
  confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
});

/**
 * O plano como o fundador quer gravá-lo. Opcional: sem ele, o servidor funde as
 * opções escolhidas por conta própria — é o caminho de aceitar a proposta como
 * ela veio, e é o que garante que o browser não possa alegar que o agente propôs
 * algo que ele não propôs.
 *
 * Com ele, o texto é do fundador: ele acabou de editar na tela, e recusar a
 * edição seria oferecer um formulário que não grava o que mostra. A proveniência
 * não se perde nesse caminho — `optionIndexes` continua dizendo de qual proposta
 * e de quais opções este plano saiu.
 */
export const strategyDraftBody = z.object({
  name: z.string().min(1).max(200),
  strategicThesis: z.string().min(1).max(2000),
  growthMechanism: z.string().min(1).max(160),
  expectedOutcome: z.string().min(1).max(1000),
  // Os tetos das listas são os de uma combinação inteira, não os de uma opção:
  // `optionSchema` deixa cada opção trazer 6 canais, 5 premissas, 5 riscos e 3
  // hipóteses, e uma adoção pode fundir três opções. Enquanto estes números
  // eram os de um plano só (12/10/10), fundir três propostas cheias produzia um
  // rascunho que o próprio servidor recusava serializar — 500 na tela, e a
  // combinação que o fundador acabou de montar simplesmente não abria.
  // Cortar as listas para caber seria pior: some a premissa de uma das opções
  // combinadas sem dizer que sumiu.
  channels: z.array(z.string().min(1).max(160)).min(1).max(18),
  assumptions: z.array(z.string().min(1).max(500)).min(1).max(15),
  risks: z.array(z.string().min(1).max(500)).min(1).max(15),
  hypotheses: z.array(hypothesisDraft).min(1).max(9),
});

export const fromProposalBody = z.object({
  agentRunId: z.string().uuid(),
  // Uma adoção pode combinar duas ou três opções da mesma proposta num único
  // plano. O teto é o da própria proposta (`options` vai até 3), então pedir
  // mais que isso é sempre um pedido inválido, não uma escolha ambiciosa.
  optionIndexes: z.array(z.number().int().min(0)).min(1).max(3),
  strategy: strategyDraftBody.optional(),
});

export type FromProposalBody = z.infer<typeof fromProposalBody>;
export type StrategyDraftBody = z.infer<typeof strategyDraftBody>;

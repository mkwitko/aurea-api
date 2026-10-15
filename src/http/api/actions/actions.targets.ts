import type { ActionStatus, ActionTargetStatus } from '@prisma/client';

/**
 * Os alvos que **nós** enviamos numa publicação (spec §8.1, passo 2).
 *
 * `PUBLISHED` está fora porque o post existe; `DELIVERY_UNKNOWN` porque ele
 * *pode* existir, e um segundo envio criaria um post público duplicado que a
 * AUREA não consegue apagar. `PUBLISHING` está fora porque já está em voo.
 *
 * A exceção é o `/posts/retry` do provider, que não recebe lista de plataformas:
 * ele retenta o que ele mesmo registrou como falho, e é a única parte que sabe o
 * desfecho de um alvo incerto.
 */
export const PUBLISHABLE_TARGET: ActionTargetStatus[] = ['PENDING', 'FAILED'];

export type TargetStatusView = { status: ActionTargetStatus };

/**
 * O status da Action derivado dos alvos.
 *
 * `null` significa "não escreva nada": ou não há alvo, ou nenhum alvo saiu do
 * `PENDING` e o status da Action é o do ciclo de aprovação. Escrever nesse caso
 * sobrescreveria o ato humano com o estado da entrega.
 *
 * A ordem das regras é a do spec §4.3 e importa: `PARTIALLY_EXECUTED` vem antes
 * de `DELIVERY_UNKNOWN` porque, com um post público no ar, a pergunta
 * "publicou?" já tem resposta parcial afirmativa — e o alvo incerto continua
 * visível no detalhe.
 */
export function aggregateActionStatus(targets: TargetStatusView[]): ActionStatus | null {
  if (targets.length === 0) return null;

  const has = (status: ActionTargetStatus): boolean => targets.some((target) => target.status === status);
  const every = (status: ActionTargetStatus): boolean => targets.every((target) => target.status === status);

  if (has('PUBLISHING')) return 'EXECUTING';
  if (every('PENDING')) return null;
  if (every('PUBLISHED')) return 'EXECUTED';
  if (has('PUBLISHED')) return 'PARTIALLY_EXECUTED';
  if (has('DELIVERY_UNKNOWN')) return 'DELIVERY_UNKNOWN';
  // Nada publicado, nada incerto, e algo à espera: é o retorno de uma resolução
  // humana de "não publicou", e a ação volta a ser executável.
  if (has('PENDING')) return 'APPROVED';
  return 'FAILED';
}

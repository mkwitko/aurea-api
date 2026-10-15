import { ActionStatus } from '@prisma/client';
import { BadRequestError } from '../../../lib/errors.js';

/**
 * As arestas que existem. Formato de `experiments.domain.ts`, e pela mesma
 * razão: a tabela é lida por humano, e uma condição espalhada por controllers
 * não é.
 *
 * `EXECUTING` não é movido por rota: quem o tira do lugar é o processor, o poll
 * ou o reaper — e todos escrevem o status pela agregação dos alvos
 * (`actions.targets.ts`), nunca à mão.
 *
 * `DELIVERY_UNKNOWN` **não** é executável, e voltou a não ser na migração para a
 * Post for Me: aquele provider não tem endpoint de retry, então não existe id que
 * ele reconheça para "retentar o que falhou". Sem isso, executar de um alvo
 * incerto é um segundo envio às cegas, que duplica post público. A saída é
 * humana, alvo por alvo (spec de migração §2.5).
 *
 * `providerPostId` continua existindo, e serve para **ler** o desfecho — o que é
 * seguro — não para retentar.
 *
 * `CANCELLED` não é alcançável de `DELIVERY_UNKNOWN`: cancelar o que talvez
 * tenha publicado esconderia o fato.
 */
export const TRANSITIONS: Record<ActionStatus, ActionStatus[]> = {
  [ActionStatus.PROPOSED]: [ActionStatus.PENDING_APPROVAL, ActionStatus.CANCELLED],
  [ActionStatus.PENDING_APPROVAL]: [ActionStatus.APPROVED, ActionStatus.PROPOSED, ActionStatus.CANCELLED],
  [ActionStatus.APPROVED]: [ActionStatus.EXECUTING, ActionStatus.CANCELLED],
  [ActionStatus.EXECUTING]: [
    ActionStatus.EXECUTED,
    ActionStatus.PARTIALLY_EXECUTED,
    ActionStatus.FAILED,
    ActionStatus.DELIVERY_UNKNOWN,
  ],
  [ActionStatus.PARTIALLY_EXECUTED]: [ActionStatus.EXECUTING, ActionStatus.CANCELLED],
  [ActionStatus.FAILED]: [ActionStatus.EXECUTING, ActionStatus.CANCELLED],
  [ActionStatus.DELIVERY_UNKNOWN]: [
    ActionStatus.EXECUTED,
    ActionStatus.PARTIALLY_EXECUTED,
    ActionStatus.APPROVED,
  ],
  [ActionStatus.EXECUTED]: [],
  [ActionStatus.CANCELLED]: [],
};

export function assertActionTransition(from: ActionStatus, to: ActionStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new BadRequestError(`Cannot move action from ${from} to ${to}`);
  }
}

/** Os estados de onde uma execução pode partir. Usado pelo compare-and-swap. */
export const EXECUTABLE_FROM: ActionStatus[] = [
  ActionStatus.APPROVED,
  ActionStatus.PARTIALLY_EXECUTED,
  ActionStatus.FAILED,
];

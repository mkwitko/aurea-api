import type { Action, ActionStatus, ActionTarget, Prisma } from '@prisma/client';
import { NotFoundError } from '../../../lib/errors.js';
import { assertActionTransition } from './actions.domain.js';
import type { ActionsRepository } from './actions.repository.js';

export type TransitionActionDeps = { repo: ActionsRepository };

/** A ação como toda resposta a devolve: com os alvos. */
export type ActionWithTargets = Action & { targets: ActionTarget[] };

/**
 * O caminho comum das mudanças de estado feitas por humano: achar dentro do
 * workspace, checar a aresta, escrever. Mesma forma de
 * `experiments.transition.ts`.
 *
 * `write` existe para as rotas que escrevem mais de uma tabela (submeter,
 * decidir): elas fazem a checagem aqui e delegam a escrita ao repositório, que
 * a faz numa transação.
 */
export function transitionActionService(deps: TransitionActionDeps) {
  return async (input: {
    workspaceId: string;
    id: string;
    to: ActionStatus;
    extra?: (current: ActionWithTargets) => Prisma.ActionUpdateInput;
    write?: (current: ActionWithTargets) => Promise<ActionWithTargets>;
  }): Promise<ActionWithTargets> => {
    const current = await deps.repo.findById(input.workspaceId, input.id);
    // Escopado pelo workspace: um id de outro tenant lê como ausente.
    if (!current) throw new NotFoundError('Action not found');
    assertActionTransition(current.status, input.to);

    if (input.write) return input.write(current);
    return deps.repo.update(current.id, { status: input.to, ...(input.extra?.(current) ?? {}) });
  };
}

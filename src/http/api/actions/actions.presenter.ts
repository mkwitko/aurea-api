import type { Action, ActionTarget, Approval } from '@prisma/client';
import { parseActionPayload } from './actions.payload.js';

/**
 * `?? null` em todo campo nulável, e não passagem direta.
 *
 * Um fixture montado à mão tem essas chaves **ausentes** (`undefined`), e
 * `z.date().nullable()` recusa `undefined` — a serialização estouraria 500 num
 * caso que o teste escreveu para valer null. Já custou isso uma vez, no
 * presenter de outcomes.
 */
export function presentAction(row: Action) {
  return {
    id: row.id,
    experimentId: row.experimentId ?? null,
    type: row.type,
    name: row.name,
    description: row.description ?? null,
    payload: parseActionPayload(row.type, row.payload),
    status: row.status,
    createdBy: row.createdBy,
    approvedAt: row.approvedAt ?? null,
    executedAt: row.executedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * O alvo como a tela precisa dele.
 *
 * `postUrl` sai como veio do provider — a tela o mostra como link, e é o que
 * torna "publicado" verificável pelo fundador em um clique. Nenhuma URL é
 * construída aqui.
 */
export function presentTarget(row: ActionTarget) {
  return {
    id: row.id,
    platform: row.platform,
    status: row.status,
    externalId: row.externalId ?? null,
    postUrl: row.postUrl ?? null,
    lastError: row.lastError ?? null,
    failureKind: row.failureKind ?? null,
    attempts: row.attempts,
    publishedAt: row.publishedAt ?? null,
    updatedAt: row.updatedAt,
  };
}

/** A ação com seus alvos, no envelope que `actionResponse` espera. */
export function presentActionWithTargets(row: Action & { targets: ActionTarget[] }) {
  return { action: presentAction(row), targets: row.targets.map(presentTarget) };
}

/**
 * O item da lista, achatado: `actionsListResponse` estende a entidade com os
 * alvos em vez de aninhar um envelope por linha, que faria a tela desempacotar
 * `actions[i].action.name`.
 */
export function presentActionListItem(row: Action & { targets: ActionTarget[] }) {
  return { ...presentAction(row), targets: row.targets.map(presentTarget) };
}

export function presentApproval(row: Approval) {
  return {
    id: row.id,
    requestedBy: row.requestedBy,
    reviewedBy: row.reviewedBy ?? null,
    status: row.status,
    comment: row.comment ?? null,
    requestedAt: row.requestedAt,
    reviewedAt: row.reviewedAt ?? null,
  };
}

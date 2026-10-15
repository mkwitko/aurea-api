import type { Prisma, PrismaClient } from '@prisma/client';
import { aggregateActionStatus } from '../http/api/actions/actions.targets.js';

/**
 * Escreve na Action o status derivado dos alvos.
 *
 * É o **único** lugar que escreve `Action.status` durante a execução: o processor,
 * o poll, o worker e o reaper todos passam por aqui. Um deles escrevendo status à
 * mão colocaria a Action em desacordo com os alvos, e a tela mostraria "falhou"
 * ao lado de um post publicado.
 *
 * `null` da agregação significa "não escreva o status": ou não há alvo, ou nenhum
 * saiu do `PENDING` e o status da Action é o do ciclo de aprovação (spec §4.3).
 * `extra` ainda é escrito nesse caso — é onde vive o `heartbeatAt: null`, que não
 * depende do desfecho.
 */
export async function writeAggregatedStatus(
  prisma: PrismaClient,
  actionId: string,
  extra: Prisma.ActionUpdateInput = {},
): Promise<void> {
  const targets = await prisma.actionTarget.findMany({ where: { actionId }, select: { status: true } });
  const status = aggregateActionStatus(targets);

  if (!status) {
    if (Object.keys(extra).length > 0) await prisma.action.update({ where: { id: actionId }, data: extra });
    return;
  }

  await prisma.action.update({ where: { id: actionId }, data: { status, ...extra } });
}

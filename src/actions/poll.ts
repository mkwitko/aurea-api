import type { PlatformOutcome } from '../integrations/social/index.js';
import { env } from '../config/env.js';
import { findSocialIntegration } from '../http/api/integrations/social-accounts.service.js';
import { SOCIAL_POST_TARGET_ENTITY } from '../http/api/actions/actions.repository.js';
import { enqueueActionPoll, type ActionPollJob } from './queue.js';
import { writeAggregatedStatus } from './aggregate.js';
import { buildSocialClient, type ActionProcessorDeps } from './processor.js';

/** Uma leitura de status, não uma publicação. */
const TIMEOUT_MS = 15_000;

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'P2002';
}

/**
 * A leitura que decide o desfecho, e a única fonte de "publicado".
 *
 * Ler é seguro: `GET /v1/social-post-results` não cria nada, então uma falha aqui
 * só agenda a próxima leitura. É por isso que este caminho pode retentar à
 * vontade, enquanto o de publicação não pode retentar nunca sem saber se criou
 * (spec §8.4).
 *
 * O que **não** é permitido é afirmar publicação a partir da resposta do `POST`:
 * um id de post não é um post publicado. Só o que vem daqui, com o `platform_data`
 * da fonte, vira `PUBLISHED`.
 */
export async function pollAction(deps: ActionProcessorDeps, job: ActionPollJob): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const enqueuePoll = deps.enqueuePoll ?? enqueueActionPoll;

  // Os dois ids juntos, como no processor: o `workspaceId` é a fronteira.
  const action = await deps.prisma.action.findFirst({
    where: { id: job.actionId, workspaceId: job.workspaceId },
    include: { targets: true },
  });
  if (!action) {
    deps.logger.info({ actionId: job.actionId }, 'poll skipped: the action is gone');
    return;
  }
  if (!action.providerPostId) {
    deps.logger.info({ actionId: action.id }, 'poll skipped: no post id to read');
    return;
  }
  // Um humano resolveu, cancelou ou uma leitura anterior já fechou tudo.
  if (action.status !== 'EXECUTING') {
    deps.logger.info({ actionId: action.id, status: action.status }, 'poll skipped: not executing');
    return;
  }

  const integration = await findSocialIntegration(deps.prisma, action.workspaceId);
  if (!integration) {
    deps.logger.error({ actionId: action.id }, 'poll skipped: the social integration is gone');
    return;
  }

  const inFlight = action.targets.filter((target) => target.status === 'PUBLISHING');

  /** Reagenda, ou fecha por esgotamento. Falha de leitura passa por aqui também. */
  const scheduleNext = async (reason: string): Promise<void> => {
    const next = job.poll + 1;
    if (next < env.ACTION_POLL_MAX_ATTEMPTS) {
      await enqueuePoll({ actionId: action.id, workspaceId: action.workspaceId, poll: next });
      await deps.prisma.action.update({ where: { id: action.id }, data: { heartbeatAt: now() } });
      return;
    }

    // Sem leituras restantes e com alvo ainda em voo: não sabemos se publicou, e
    // dizer `FAILED` negaria um post que pode existir. O `providerRequestId`
    // continua gravado, então retentar dali ainda é possível (spec §8.3, caso 2).
    if (inFlight.length > 0) {
      await deps.prisma.actionTarget.updateMany({
        where: { id: { in: inFlight.map((target) => target.id) } },
        data: {
          status: 'DELIVERY_UNKNOWN',
          // A mensagem da tentativa é preservada quando existe: sobrescrevê-la
          // apagaria a única pista que o fundador tem.
          lastError: reason,
          failureKind: 'UNKNOWN',
        },
      });
    }
    await writeAggregatedStatus(deps.prisma, action.id, { heartbeatAt: null });
    deps.logger.error({ actionId: action.id, polls: job.poll + 1 }, 'gave up reading the publication status');
  };

  let outcomes;
  try {
    outcomes = await buildSocialClient(deps).results(action.providerPostId, AbortSignal.timeout(TIMEOUT_MS));
  } catch (error) {
    // Nada é escrito no alvo: uma leitura que falhou não diz nada sobre o post.
    const reason = error instanceof Error ? error.message : 'unknown error';
    deps.logger.info({ actionId: action.id, reason }, 'status read failed, will read again');
    await scheduleNext(`the publication status could not be read: ${reason}`);
    return;
  }

  /**
   * Casado por **conta**, não por rede: duas contas podem viver na mesma rede, e
   * casar por plataforma escreveria o desfecho de uma na outra.
   */
  const byAccount = new Map(
    action.targets
      .filter((target) => target.socialAccountId !== null)
      .map((target) => [target.socialAccountId as string, target]),
  );

  for (const outcome of outcomes) {
    const target = byAccount.get(outcome.socialAccountId);
    // Conta que não é alvo desta ação: o provider mandou algo que não pedimos, e
    // escrever por causa disso inventaria desfecho.
    if (!target) continue;
    // Um alvo que já está publicado não é reescrito: `publishedAt` é do momento em
    // que soubemos, e sobrescrevê-lo a cada leitura moveria a data para sempre.
    if (target.status === 'PUBLISHED') continue;

    if (outcome.success) {
      await recordPublished(deps, {
        workspaceId: action.workspaceId,
        integrationId: integration.integrationId,
        targetId: target.id,
        platform: target.platform,
        outcome,
        now: now(),
      });
      continue;
    }

    // Falha por plataforma é **sempre** `FAILED`, qualquer que seja a mensagem: o
    // provider tentou, sabe o que aconteceu, e está nos dizendo. Não é
    // indeterminação (spec §8.4).
    await deps.prisma.actionTarget.update({
      where: { id: target.id },
      data: {
        status: 'FAILED',
        lastError: outcome.message ?? 'the provider refused this platform',
        failureKind: 'PROVIDER',
      },
    });
  }

  /**
   * Não há status agregado a ler: `results` devolve uma linha por conta **já
   * processada**. Completo, então, é "todo alvo em voo foi mencionado" — e enquanto
   * faltar um, a leitura volta.
   *
   * É o contrário de assumir conclusão por ausência: um alvo sem linha é um alvo
   * que o provider ainda não terminou, não um alvo que falhou.
   */
  const stillFlying = await deps.prisma.actionTarget.findMany({
    where: { actionId: action.id, status: 'PUBLISHING' },
  });
  if (stillFlying.length > 0) {
    await scheduleNext('the publication is still being processed');
    return;
  }

  const published = await deps.prisma.actionTarget.count({
    where: { actionId: action.id, status: 'PUBLISHED' },
  });
  await writeAggregatedStatus(deps.prisma, action.id, {
    heartbeatAt: null,
    // `executedAt` marca a primeira publicação confirmada, e não é reescrito.
    ...(published > 0 && !action.executedAt ? { executedAt: now() } : {}),
  });
}

/**
 * Grava o alvo publicado e a proveniência dele.
 *
 * A violação de unique (P2002) conta como **sucesso**: significa que outra leitura
 * já registrou o mesmo post, e é exatamente o que a trava no banco existe para
 * garantir — um post por rede por ação (spec §8.1, passo 6).
 */
async function recordPublished(
  deps: ActionProcessorDeps,
  input: {
    workspaceId: string;
    integrationId: string;
    targetId: string;
    platform: string;
    outcome: PlatformOutcome;
    now: Date;
  },
): Promise<void> {
  if (input.outcome.externalId) {
    try {
      await deps.prisma.externalReference.create({
        data: {
          workspaceId: input.workspaceId,
          integrationId: input.integrationId,
          entityType: SOCIAL_POST_TARGET_ENTITY,
          entityId: input.targetId,
          externalId: input.outcome.externalId,
          metadata: { platform: input.platform, url: input.outcome.postUrl },
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      deps.logger.info({ targetId: input.targetId }, 'another read already recorded this post');
    }
  }

  await deps.prisma.actionTarget.update({
    where: { id: input.targetId },
    data: {
      status: 'PUBLISHED',
      externalId: input.outcome.externalId,
      postUrl: input.outcome.postUrl,
      publishedAt: input.now,
      lastError: null,
      failureKind: null,
    },
  });
}

import type { PrismaClient } from '@prisma/client';
import {
  createSocialClient,
  isIndeterminate,
  isRetriable,
  SocialProviderError,
  type SocialClient,
} from '../integrations/social/index.js';
import { env } from '../config/env.js';
import { findSocialIntegration } from '../http/api/integrations/social-accounts.service.js';
import { PUBLISHABLE_TARGET } from '../http/api/actions/actions.targets.js';
import { parseActionPayload } from '../http/api/actions/actions.payload.js';
import { enqueueActionPoll, type ActionExecutionJob } from './queue.js';
import { writeAggregatedStatus } from './aggregate.js';

/** Uma publicação, não um relatório. */
const TIMEOUT_MS = 20_000;

export type ActionProcessorDeps = {
  prisma: PrismaClient;
  logger: { info: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
  /**
   * O cliente, injetável: é o seam que mantém a suíte fora da rede. Recebe o
   * cliente **pronto**, e não a config — a chave vem de `env`, que é parseado no
   * import, e um teste não consegue mudá-la depois.
   */
  socialClient?: () => SocialClient;
  /** A fila, injetável pela mesma razão: nenhum teste toca o Redis. */
  enqueuePoll?: typeof enqueueActionPoll;
  now?: () => Date;
};

/**
 * O cliente montado da chave da conta AUREA. Exportado porque o poll usa
 * exatamente a mesma fábrica — duas montagens divergiriam em base ou header.
 */
export function buildSocialClient(deps: ActionProcessorDeps): SocialClient {
  if (deps.socialClient) return deps.socialClient();
  // `AUTH` e não `UNKNOWN`: sem chave, nada foi tentado, e o desfecho tem de ser
  // `FAILED` — não indeterminado.
  if (!env.POST_FOR_ME_API_KEY) throw new SocialProviderError('AUTH', 'this instance has no social api key');
  return createSocialClient({ apiKey: env.POST_FOR_ME_API_KEY, baseUrl: env.POST_FOR_ME_BASE_URL });
}

/**
 * O único lugar do sistema que pede uma publicação.
 *
 * Relança **apenas** quando o kind é retentável (`RATE_LIMIT`, `PROVIDER`):
 * relançar é o que faz o BullMQ tentar de novo, e tentar de novo o que talvez
 * tenha publicado é o que cria um post público duplicado.
 *
 * Não há caminho de "retry do provider": a Post for Me não tem esse endpoint, e
 * tentar outra vez é um post novo — que a rota só permite quando existe alvo
 * `PENDING` ou `FAILED`, ou seja, quando o resultado anterior disse que não criou
 * (spec de migração §2.5).
 */
export async function executeAction(deps: ActionProcessorDeps, job: ActionExecutionJob): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const enqueuePoll = deps.enqueuePoll ?? enqueueActionPoll;

  // Os dois ids do job, juntos. O `workspaceId` é a fronteira: sem ele, uma
  // Action lida por id publicaria pelas contas de quem enfileirou, e a chave do
  // provider é a mesma para todos os clientes (spec de migração §4).
  const action = await deps.prisma.action.findFirst({
    where: { id: job.actionId, workspaceId: job.workspaceId },
    include: { targets: true },
  });
  if (!action) {
    deps.logger.info({ actionId: job.actionId }, 'action execution skipped: the action is gone');
    return;
  }

  // Cancelada, resolvida ou já concluída enquanto o job esperava na fila.
  if (action.status !== 'EXECUTING') {
    deps.logger.info({ actionId: action.id, status: action.status }, 'action execution skipped: not executing');
    return;
  }

  /**
   * Os alvos que este job envia: os que a rota marcou `PUBLISHING`, mais os que
   * ficaram publicáveis por uma corrida. `PUBLISHED` tem post no mundo e
   * `DELIVERY_UNKNOWN` pode ter — nenhum dos dois entra numa chamada nossa.
   */
  const flying = action.targets.filter(
    (target) => target.status === 'PUBLISHING' || PUBLISHABLE_TARGET.includes(target.status),
  );
  const flyingIds = flying.map((target) => target.id);

  const markTargets = async (
    ids: string[],
    data: { status?: 'FAILED' | 'DELIVERY_UNKNOWN'; lastError: string; failureKind: string },
  ): Promise<void> => {
    if (ids.length === 0) return;
    await deps.prisma.actionTarget.updateMany({ where: { id: { in: ids } }, data });
  };

  const integration = await findSocialIntegration(deps.prisma, action.workspaceId);
  // Nada saiu, então `FAILED` e não `DELIVERY_UNKNOWN`: mandar o fundador conferir
  // uma rede onde nada foi tentado é pior que dizer que falhou.
  if (!integration) {
    await markTargets(flyingIds, {
      status: 'FAILED',
      lastError: 'no social account is connected to this workspace',
      failureKind: 'AUTH',
    });
    await writeAggregatedStatus(deps.prisma, action.id, { heartbeatAt: null });
    return;
  }

  /**
   * Montar o cliente e ler o payload podem falhar por si — chave ausente, payload
   * gravado fora do contrato — e isso acontece **antes** de qualquer pedido sair.
   * Fica em try próprio, com desfecho `FAILED`, e não no try da chamada: usar a
   * tabela de classificação aqui marcaria indeterminado o que nunca saiu.
   */
  let client: SocialClient;
  let content: string;
  let mediaUrls: string[] | undefined;
  let title: string | undefined;
  try {
    client = buildSocialClient(deps);
    const payload = parseActionPayload(action.type, action.payload);
    content = payload.content;
    // A mídia sai do payload gravado, e não de um pedido novo: é a imagem que o
    // aprovador viu, e não a que estiver lá na hora de publicar.
    mediaUrls = payload.media;
    // O título do vídeo, que o YouTube exige. Mesma regra: o que foi aprovado.
    title = payload.title;
  } catch (error) {
    await markTargets(flyingIds, {
      status: 'FAILED',
      failureKind: error instanceof SocialProviderError ? error.kind : 'VALIDATION',
      lastError: error instanceof Error ? error.message : 'unknown error',
    });
    await writeAggregatedStatus(deps.prisma, action.id, { heartbeatAt: null });
    return;
  }

  /**
   * Um alvo sem conta é a guarda de um estado que não deveria existir: a criação
   * resolve a conta de cada rede antes de gravar o alvo. `FAILED` e não
   * indeterminado — nada foi enviado por ele.
   */
  const withAccount = flying.filter((target) => target.socialAccountId !== null);
  const orphans = flying.filter((target) => target.socialAccountId === null);
  if (orphans.length > 0) {
    await markTargets(
      orphans.map((target) => target.id),
      {
        status: 'FAILED',
        lastError: 'this target has no social account to publish to',
        failureKind: 'VALIDATION',
      },
    );
  }

  if (withAccount.length === 0) {
    deps.logger.info({ actionId: action.id }, 'nothing to publish: no target has an account');
    await writeAggregatedStatus(deps.prisma, action.id, { heartbeatAt: null });
    return;
  }

  // O sinal de vida vai antes da chamada: é o que separa lento de morto para o
  // reaper, e a chamada é justamente a parte que pode demorar.
  await deps.prisma.action.update({ where: { id: action.id }, data: { heartbeatAt: now() } });

  let result;
  try {
    result = await client.publish(
      {
        caption: content,
        socialAccountIds: withAccount.map((target) => target.socialAccountId as string),
        externalId: integration.externalId,
        mediaUrls,
        // As redes que de fato vão receber, e não as do payload: um alvo sem conta
        // ficou de fora acima, e mandar configuração para uma rede que não está no
        // post é ruído que o provider aceita calado.
        platforms: withAccount.map((target) => target.platform),
        title,
      },
      AbortSignal.timeout(TIMEOUT_MS),
    );
  } catch (error) {
    const kind = error instanceof SocialProviderError ? error.kind : 'UNKNOWN';
    const reason = error instanceof Error ? error.message : 'unknown error';
    const ids = withAccount.map((target) => target.id);

    if (isRetriable(kind)) {
      // Alvos intactos em `PUBLISHING`, e o BullMQ tenta de novo. Só a mensagem é
      // gravada, para a tela mostrar o motivo da espera.
      await deps.prisma.actionTarget.updateMany({
        where: { id: { in: ids } },
        data: { lastError: reason, failureKind: kind },
      });
      throw error;
    }

    await markTargets(ids, {
      // Indeterminado: não se sabe se o provider criou, e um segundo envio
      // duplicaria. A saída é humana, alvo por alvo (spec de migração §2.5).
      status: isIndeterminate(kind) ? 'DELIVERY_UNKNOWN' : 'FAILED',
      lastError: reason,
      failureKind: kind,
    });
    await writeAggregatedStatus(deps.prisma, action.id, { heartbeatAt: null });
    return;
  }

  // O id do post primeiro, antes de qualquer outra escrita: é o que torna a falha
  // seguinte recuperável — sem ele, não há o que consultar.
  await deps.prisma.action.update({ where: { id: action.id }, data: { providerPostId: result.postId } });
  await enqueuePoll({ actionId: action.id, workspaceId: action.workspaceId, poll: 0 });
}

import type { PrismaClient } from '@prisma/client';
import {
  createSocialClient,
  socialExternalId,
  type SocialAccount,
  type SocialClient,
} from '../../../integrations/social/index.js';
import { env } from '../../../config/env.js';
import { seal } from '../../../billing/crypto.js';
import { SocialNotConfiguredError, SocialRequestFailedError } from '../../../lib/errors.js';
import { createIntegrationsRepository } from './integrations.repository.js';

export const SOCIAL_PROVIDER = 'POST_FOR_ME';

/** Uma leitura de contas, não uma publicação. */
const TIMEOUT_MS = 10_000;

/**
 * A fábrica do cliente, injetável. É este o seam que mantém a suíte fora da
 * rede: nenhum teste precisa lembrar de substituir um decorator ambiente, e um
 * que esquecesse sairia falando com o provider de dentro da suíte.
 */
export type SocialClientFactory = () => SocialClient;

export type SocialRoutesOptions = { social?: SocialClientFactory };

/**
 * O cliente real, montado da chave da **conta AUREA**.
 *
 * Sem chave, `SOCIAL_NOT_CONFIGURED` (503) e não 400: não há nada que o fundador
 * possa corrigir na requisição dele.
 */
export const socialClientFactory: SocialClientFactory = () => {
  if (!env.POST_FOR_ME_API_KEY) throw new SocialNotConfiguredError();
  return createSocialClient({ apiKey: env.POST_FOR_ME_API_KEY, baseUrl: env.POST_FOR_ME_BASE_URL });
};

/**
 * Garante a linha local do provider social, e devolve o `external_id` do
 * workspace.
 *
 * **Não chama o provider**: não há perfil a criar — contas nascem quando o
 * cliente autoriza uma rede, e o `external_id` é só um carimbo que vai no pedido
 * de autorização (spec de migração §4).
 *
 * A linha existe por dois motivos: é onde `ExternalReference.integrationId` se
 * pendura, e é o que a tela lê para saber que o workspace já passou por aqui.
 * Sem segredo por workspace — a chave é da conta — então sela um objeto vazio,
 * porque as três colunas de cifra são `Bytes` não-nulas e inventar uma nulidade
 * nova na tabela por causa de um provider mudaria o schema por nada.
 */
export async function ensureSocialIntegration(
  prisma: PrismaClient,
  workspaceId: string,
  userId: string,
): Promise<{ integrationId: string; externalId: string }> {
  const externalId = socialExternalId(workspaceId);

  const integration = await createIntegrationsRepository(prisma).upsertAccountProfile({
    workspaceId,
    provider: SOCIAL_PROVIDER,
    externalId,
    accountLabel: 'Post for Me',
    createdBy: userId,
    status: 'OK',
    lastError: null,
    checkedAt: new Date(),
    ...seal(JSON.stringify({})),
  });

  return { integrationId: integration.id, externalId };
}

/**
 * A linha já existente, sem tocar na rede.
 *
 * `null` quando não há: o chamador decide entre "conecte suas redes" (a tela) e
 * recusar a publicação (o processor). Sempre lida por `workspaceId` — é a
 * fronteira entre os clientes, porque a chave do provider é a mesma para todos
 * (spec de migração §4).
 */
export async function findSocialIntegration(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<{ integrationId: string; externalId: string } | null> {
  const row = await createIntegrationsRepository(prisma).find(workspaceId, SOCIAL_PROVIDER);
  if (!row?.externalId) return null;
  return { integrationId: row.id, externalId: row.externalId };
}

/**
 * As contas do workspace, lidas ao vivo e filtradas pelo `external_id` dele.
 *
 * É **a única** porta por onde ids de conta entram no sistema: publicar só usa
 * ids que esta função devolveu, e é isso que impede uma conta de outro cliente de
 * ser alvo — ela nunca esteve na lista (spec de migração §4).
 *
 * Nunca persistida: a lista muda no provider, e uma cópia nossa mostraria uma
 * conta que o cliente já desconectou.
 */
export async function listWorkspaceAccounts(
  deps: { prisma: PrismaClient; clientFor: SocialClientFactory },
  workspaceId: string,
): Promise<SocialAccount[]> {
  const integration = await findSocialIntegration(deps.prisma, workspaceId);
  // Nunca ter conectado é estado legítimo, e a tela mostra o caminho.
  if (!integration) return [];

  try {
    return await deps.clientFor().listAccounts(integration.externalId, AbortSignal.timeout(TIMEOUT_MS));
  } catch (error) {
    // A mensagem do provider chega ao fundador: ela diz o que fazer.
    throw new SocialRequestFailedError({
      reason: error instanceof Error ? error.message : 'unknown error',
    });
  }
}

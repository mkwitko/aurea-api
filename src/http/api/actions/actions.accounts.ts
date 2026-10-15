import type { PrismaClient, SocialPlatform } from '@prisma/client';
import { SocialAccountNotConnectedError, SocialNotConnectedError } from '../../../lib/errors.js';
import { listWorkspaceAccounts, type SocialClientFactory } from '../integrations/social-accounts.service.js';

/**
 * A conta que cada rede pedida vai receber.
 *
 * A leitura é ao vivo pela mesma razão de sempre: a lista muda no provider, e um
 * cache mostraria uma conta que o cliente já desconectou. Aceitar uma rede sem
 * conta só falharia na publicação — depois de alguém ter aprovado o texto.
 *
 * Conta `connected: false` conta como ausente: publicar nela falharia, e recusar
 * aqui transforma um erro futuro num aviso presente (spec de migração §2.3).
 *
 * O id devolvido é gravado no alvo, e é **o único** id de conta que chega à
 * publicação — ele veio de uma lista já filtrada pelo `external_id` do workspace,
 * então uma conta de outro cliente nunca esteve disponível para ser alvo
 * (spec de migração §4).
 */
export async function resolveTargetAccounts(
  deps: { prisma: PrismaClient; clientFor: SocialClientFactory },
  workspaceId: string,
  platforms: SocialPlatform[],
): Promise<Map<SocialPlatform, string>> {
  const accounts = await listWorkspaceAccounts(deps, workspaceId);
  // Código próprio, e não 404: a tela oferece conectar, não recarregar.
  if (accounts.length === 0) throw new SocialNotConnectedError();

  const byPlatform = new Map<SocialPlatform, string>();
  for (const account of accounts) {
    if (!account.connected) continue;
    // A primeira conta de cada rede. Duas contas na mesma rede são possíveis no
    // provider, mas um alvo é unique por `[actionId, platform]`: escolher qual
    // delas é decisão de produto que ainda não existe.
    if (!byPlatform.has(account.platform)) byPlatform.set(account.platform, account.id);
  }

  for (const platform of platforms) {
    // Nomeia a rede: "conecte o LinkedIn" resolve, "conecte suas redes" faz o
    // fundador procurar qual.
    if (!byPlatform.has(platform)) throw new SocialAccountNotConnectedError({ platform });
  }

  return byPlatform;
}

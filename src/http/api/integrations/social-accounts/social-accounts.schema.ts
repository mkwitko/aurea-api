import { z } from 'zod';
import { socialPlatformEnum } from '../../actions/actions.schema.js';

export const socialAccountEntity = z.object({
  /** O id da conta no provider. É ele que a publicação recebe. */
  id: z.string(),
  platform: socialPlatformEnum,
  username: z.string().nullable(),
  pictureUrl: z.string().nullable(),
  /**
   * `false` quando o provider marcou a conta como desconectada. É o que permite
   * avisar o cliente **antes** de a publicação falhar — e o que faz a criação de
   * ação recusar essa rede (spec de migração §2.3).
   */
  connected: z.boolean(),
});

/**
 * A lista lida ao vivo do provider, nunca persistida: ela muda do outro lado, e
 * uma cópia nossa mostraria uma conta que o cliente já desconectou.
 *
 * `access_token` e `refresh_token` chegam na resposta do provider e param no
 * conector: este schema é a segunda barreira, e lista campos por nome.
 */
export const socialAccountsResponse = z.object({ accounts: z.array(socialAccountEntity) });

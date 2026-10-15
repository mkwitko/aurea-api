import { z } from 'zod';
import { PLATFORMS_WITH_CREDENTIALS } from '../../../../integrations/social/post-for-me/platforms.js';
import { socialPlatformEnum } from '../../actions/actions.schema.js';

/**
 * A rede que o cliente vai autorizar. Uma por chamada, porque é assim que o
 * provider funciona — e é o que faz a lista de redes ser a **nossa** tela, sem
 * página intermediária de terceiro (spec de migração §2.1).
 */
export const socialConnectUrlBody = z
  .object({
    platform: socialPlatformEnum,
    /**
     * As credenciais do Bluesky — a única rede que não conecta por OAuth.
     *
     * `handle` e senha de app, exigidos juntos e só para ela. A senha de app é
     * revogável e específica do Bluesky: é o mecanismo que eles desenharam para
     * isso, e não a senha da conta.
     *
     * Ela **atravessa** a AUREA e não fica: não é gravada, não entra em log, e
     * nenhuma resposta a devolve.
     */
    handle: z.string().min(1).max(253).optional(),
    appPassword: z.string().min(1).max(200).optional(),
  })
  .superRefine((body, ctx) => {
    const needsCredentials = PLATFORMS_WITH_CREDENTIALS.includes(body.platform);
    const hasCredentials = Boolean(body.handle && body.appPassword);

    if (needsCredentials && !hasCredentials) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'This network connects with a handle and an app password',
        path: ['handle'],
      });
    }
    // O caminho contrário também é erro: credencial mandada para uma rede de OAuth
    // não seria usada, e aceitar em silêncio faria alguém acreditar que foi.
    if (!needsCredentials && (body.handle || body.appPassword)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'This network connects with OAuth, not with a password',
        path: ['handle'],
      });
    }
  });

/**
 * A URL não é persistida: ela inicia um fluxo de OAuth de uso único, e guardá-la
 * produziria um botão que leva a um fluxo expirado.
 */
export const socialConnectUrlResponse = z.object({ url: z.string() });

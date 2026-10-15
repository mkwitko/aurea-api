import { OAuth2Client } from 'google-auth-library';
import { env } from '../../../../config/env.js';
import { BadRequestError } from '../../../../lib/errors.js';

/**
 * Somente leitura de analytics, mais os dois escopos de identidade.
 *
 * `openid`/`email` não são sensíveis e não mexem na verificação do app; existem
 * para `verifyIdToken` devolver o e-mail da conta, que é o que o fundador
 * reconhece na tela.
 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',
  'openid',
  'email',
] as const;

export function googleOAuthConfigured(): boolean {
  return Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REDIRECT_URI);
}

/**
 * O client, ou uma recusa nomeada. Ambiente sem OAuth é estado legítimo — a
 * service account continua funcionando —, então isto é 400 com mensagem e não
 * falha de boot.
 */
export function googleOAuthClient(): OAuth2Client {
  if (!googleOAuthConfigured()) {
    throw new BadRequestError('Connecting with Google is not enabled in this environment');
  }
  return new OAuth2Client({
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
  });
}

/**
 * Revoga o refresh token no Google. Sem OAuth configurado não há o que revogar
 * — e chamar isto assim é um no-op, não um erro: o caminho de remoção não pode
 * quebrar por causa de configuração ausente.
 */
export async function revokeGoogleCredential(credentialsJson: string): Promise<void> {
  if (!googleOAuthConfigured()) return;
  const parsed = JSON.parse(credentialsJson) as { refresh_token?: unknown };
  if (typeof parsed.refresh_token !== 'string') return;
  await googleOAuthClient().revokeToken(parsed.refresh_token);
}

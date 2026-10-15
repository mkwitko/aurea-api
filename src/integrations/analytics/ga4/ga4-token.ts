import { JWT, OAuth2Client } from 'google-auth-library';
import { AnalyticsProviderError } from '../analytics-provider.js';

/**
 * Somente leitura, e isto é design e não configuração: um token que pode
 * escrever numa property é um token que pode apagar a medição do cliente.
 */
const SCOPES = ['https://www.googleapis.com/auth/analytics.readonly'];

/**
 * Cunha o token a partir do JSON de uma service account.
 *
 * Único arquivo que conhece `google-auth-library`. A biblioteca entra aqui em
 * vez de um JWT RS256 escrito à mão porque assinar e renovar token é
 * criptografia, e criptografia escrita em casa para economizar uma dependência é
 * o tipo de economia que custa um incidente. O cache de token é dela.
 */
export function serviceAccountMinter(credentialsJson: string): () => Promise<string> {
  let client: JWT | null = null;

  return async () => {
    if (!client) {
      let parsed: { client_email?: unknown; private_key?: unknown };
      try {
        parsed = JSON.parse(credentialsJson) as typeof parsed;
      } catch {
        throw new AnalyticsProviderError('the service account credential is not valid JSON');
      }
      if (typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') {
        throw new AnalyticsProviderError('the service account credential has no client_email or private_key');
      }
      client = new JWT({ email: parsed.client_email, key: parsed.private_key, scopes: SCOPES });
    }

    const { token } = await client.getAccessToken();
    if (!token) throw new AnalyticsProviderError('google did not return an access token');
    return token;
  };
}

/**
 * Cunha o token a partir de um refresh token do OAuth.
 *
 * A renovação e o cache são da biblioteca, pela mesma razão que
 * `serviceAccountMinter` delega: renovar token é criptografia, e criptografia
 * escrita em casa para economizar dependência custa um incidente.
 *
 * O `redirectUri` não entra: ele só importa na troca do código, não na
 * renovação.
 */
export function oauthMinter(
  credentialsJson: string,
  client: { clientId: string; clientSecret: string },
): () => Promise<string> {
  let oauth: OAuth2Client | null = null;

  return async () => {
    if (!oauth) {
      let parsed: { refresh_token?: unknown };
      try {
        parsed = JSON.parse(credentialsJson) as typeof parsed;
      } catch {
        throw new AnalyticsProviderError('the google credential is not valid JSON');
      }
      if (typeof parsed.refresh_token !== 'string') {
        throw new AnalyticsProviderError('the google credential has no refresh_token');
      }
      oauth = new OAuth2Client({ clientId: client.clientId, clientSecret: client.clientSecret });
      oauth.setCredentials({ refresh_token: parsed.refresh_token });
    }

    const { token } = await oauth.getAccessToken();
    if (!token) throw new AnalyticsProviderError('google did not return an access token');
    return token;
  };
}

/** O e-mail da service account, para o fundador reconhecer o que conectou. */
export function serviceAccountEmail(credentialsJson: string): string {
  try {
    const parsed = JSON.parse(credentialsJson) as { client_email?: unknown };
    return typeof parsed.client_email === 'string' ? parsed.client_email : 'unknown service account';
  } catch {
    return 'unknown service account';
  }
}

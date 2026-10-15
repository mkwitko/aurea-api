import { env } from '../../../config/env.js';
import { AnalyticsProviderError } from '../analytics-provider.js';
import { oauthMinter, serviceAccountMinter } from './ga4-token.js';

/**
 * O único lugar que escolhe o cunhador pelo `authKind`.
 *
 * Existe para que os três chamadores — a leitura da medição, a verificação da
 * credencial e a tool do agente — não repitam a escolha: três cópias de um
 * `if` sobre `authKind` divergem no dia em que entrar o terceiro caminho.
 */
export function minterFor(authKind: string, credentialsJson: string): () => Promise<string> {
  if (authKind === 'SERVICE_ACCOUNT') return serviceAccountMinter(credentialsJson);

  if (authKind === 'OAUTH') {
    const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
    // A credencial existe no banco e o ambiente não sabe renová-la: isso
    // acontece de verdade num deploy que perdeu a variável, e a mensagem tem de
    // dizer qual é o problema em vez de "não foi possível ler".
    if (!clientId || !clientSecret) {
      throw new AnalyticsProviderError('google oauth is not configured in this environment');
    }
    return oauthMinter(credentialsJson, { clientId, clientSecret });
  }

  throw new AnalyticsProviderError(`unsupported credential kind: ${authKind}`);
}

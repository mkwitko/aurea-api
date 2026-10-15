import { BadRequestError } from '../../../../lib/errors.js';

/** O que o callback precisa saber, e nada mais. */
export type OAuthState = { workspaceId: string; userId: string };

/** O `app.jwt` do Fastify, reduzido ao que este módulo usa. */
export type JwtLike = {
  sign(payload: object, options?: { expiresIn?: string }): string;
  verify(token: string): unknown;
};

/**
 * Dez minutos: é uma ida ao Google e volta.
 *
 * Sem uso único de propósito. Um replay dentro da janela reconecta o mesmo
 * workspace à mesma conta Google — o resultado que o humano pediu. Uma tabela
 * de nonce compraria pouco e custaria uma tabela.
 */
const TTL = '10m';

const PURPOSE = 'google-oauth';

/**
 * O `state` é o que autoriza o callback, que é público. Duas travas, e as duas
 * são sobre confusão entre famílias de token:
 *
 * - `purpose` impede um access token do app de servir como state;
 * - a **ausência de `sub`** impede um state de servir como Bearer, porque
 *   `authenticate`/`resolveTenant` leem `sub`. Os dois compartilham o segredo e
 *   não compartilham forma.
 */
export function signOAuthState(jwt: JwtLike, state: OAuthState): string {
  return jwt.sign({ workspaceId: state.workspaceId, userId: state.userId, purpose: PURPOSE }, { expiresIn: TTL });
}

export function verifyOAuthState(jwt: JwtLike, token: string): OAuthState {
  // `verify` estoura por conta própria em assinatura errada, token malformado e
  // expiração — mas com o erro cru do JWT, não um `AppError`. O callback é
  // público e essa recusa tem de sair como 400 nomeado, não como 500.
  let decoded: Record<string, unknown>;
  try {
    decoded = jwt.verify(token) as Record<string, unknown>;
  } catch {
    throw new BadRequestError('not a google oauth state token');
  }

  if (decoded.purpose !== PURPOSE) throw new BadRequestError('not a google oauth state token');
  if (typeof decoded.workspaceId !== 'string' || typeof decoded.userId !== 'string') {
    throw new BadRequestError('not a google oauth state token');
  }

  return { workspaceId: decoded.workspaceId, userId: decoded.userId };
}

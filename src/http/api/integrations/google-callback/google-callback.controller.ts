import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { env } from '../../../../config/env.js';
import { seal } from '../../../../billing/crypto.js';
import { BadRequestError } from '../../../../lib/errors.js';
import { createIntegrationsRepository } from '../integrations.repository.js';
import { googleOAuthClient } from '../google/google-client.js';
import { verifyOAuthState } from '../google/oauth-state.js';
import { googleCallbackQuery } from './google-callback.schema.js';

/** O que a troca do código devolve, reduzido ao que gravamos. */
export type CodeExchange = (code: string) => Promise<{ refreshToken: string | null; email: string | null }>;

export type GoogleCallbackOptions = { exchange?: CodeExchange };

const PROVIDER = 'GA4';
const RETURN_PATH = '/app/settings/integrations';

/** Vocabulário fechado: o `error` do Google vira query string da nossa app. */
const REASON = /^[a-z_]{1,40}$/;

function backTo(params: Record<string, string>): string {
  const url = new URL(RETURN_PATH, env.APP_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

/**
 * A troca real do código pelo token, e o e-mail da conta.
 *
 * `verifyIdToken` em vez de decodificar o id_token à mão: verificar assinatura
 * de JWT de terceiro é exatamente o tipo de coisa que a biblioteca faz certo.
 */
const exchangeWithGoogle: CodeExchange = async (code) => {
  const client = googleOAuthClient();
  const { tokens } = await client.getToken(code);

  let email: string | null = null;
  if (tokens.id_token) {
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: env.GOOGLE_OAUTH_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    email = typeof payload?.email === 'string' ? payload.email : null;
  }

  return { refreshToken: tokens.refresh_token ?? null, email };
};

/**
 * Público de propósito: o Google redireciona o browser, sem header nenhum.
 * Registrado direto no `app.ts`, fora do escopo autenticado, como
 * `stripeWebhookRoute`.
 *
 * Quem autoriza aqui é o `state` assinado — é dele, e de nada da query string,
 * que sai o workspace onde gravar.
 */
export const googleCallbackRoute: FastifyPluginAsync<GoogleCallbackOptions> = async (app, opts) => {
  const exchange = opts.exchange ?? exchangeWithGoogle;

  app.withTypeProvider<ZodTypeProvider>().get(
    '/integrations/google/callback',
    {
      schema: {
        tags: ['integrations'],
        operationId: 'googleCallback',
        querystring: googleCallbackQuery,
        // Sem `response`: esta rota redireciona, não devolve corpo. É a única
        // do sistema sem envelope, e a razão é o browser do outro lado.
        hide: true,
      },
    },
    async (req, reply) => {
      const { code, state, error } = req.query;

      // O state primeiro, sempre: sem ele não se sabe nem de quem é este
      // callback, e um 400 aqui não vira redirect porque não há para onde
      // voltar com confiança.
      if (!state) throw new BadRequestError('missing state');
      const { workspaceId, userId } = verifyOAuthState(app.jwt, state);

      // O fundador recusou o consentimento, ou o Google recusou por outra
      // razão. Nada foi autorizado, então nada é gravado.
      if (error) {
        return reply.redirect(backTo({ google: 'error', reason: REASON.test(error) ? error : 'unknown' }));
      }
      if (!code) return reply.redirect(backTo({ google: 'error', reason: 'missing_code' }));

      let exchanged: Awaited<ReturnType<CodeExchange>>;
      try {
        exchanged = await exchange(code);
      } catch {
        // A mensagem do Google não vai para a url. O fundador vê "não deu"; o
        // detalhe fica no log do servidor.
        req.log.warn('google oauth code exchange failed');
        return reply.redirect(backTo({ google: 'error', reason: 'exchange_failed' }));
      }

      // Sem refresh token, a conexão morreria em uma hora e voltaria como
      // "medição falhou" dias depois. Melhor não existir.
      if (!exchanged.refreshToken) {
        return reply.redirect(backTo({ google: 'error', reason: 'no_refresh_token' }));
      }

      await createIntegrationsRepository(app.prisma).upsertOauth({
        workspaceId,
        provider: PROVIDER,
        accountLabel: exchanged.email ?? 'google account',
        createdBy: userId,
        connectedAt: new Date(),
        ...seal(JSON.stringify({ refresh_token: exchanged.refreshToken })),
      });

      return reply.redirect(backTo({ google: 'connected' }));
    },
  );
};

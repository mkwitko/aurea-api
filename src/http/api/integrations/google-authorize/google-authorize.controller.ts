import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { assertAdmin } from '../../../../lib/tenant.js';
import { GOOGLE_SCOPES, googleOAuthClient } from '../google/google-client.js';
import { signOAuthState } from '../google/oauth-state.js';
import { googleAuthorizeResponse } from './google-authorize.schema.js';

/**
 * Devolve a url em vez de redirecionar.
 *
 * A navegação do browser não carrega o header `Authorization`, então o frontend
 * busca a url com o token e só então navega. Um GET que redirecionasse teria de
 * aceitar o token na query string, e token em url vai para histórico e log de
 * proxy.
 */
export const googleAuthorizeRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/integrations/google/authorize',
    {
      schema: {
        tags: ['integrations'],
        operationId: 'authorizeGoogle',
        response: { 200: googleAuthorizeResponse },
      },
    },
    async (req, reply) => {
      assertAdmin(req.tenant);

      const url = googleOAuthClient().generateAuthUrl({
        // `offline` + `consent` é o que garante um refresh_token. Sem ele a
        // conexão morre em uma hora e volta como "medição falhou" depois.
        access_type: 'offline',
        prompt: 'consent',
        scope: [...GOOGLE_SCOPES],
        state: signOAuthState(app.jwt, {
          // O workspace sai do tenant e viaja assinado: é ele que o callback,
          // que é público, vai usar para saber onde gravar.
          workspaceId: req.tenant.workspaceId,
          userId: req.tenant.userId,
        }),
      });

      return reply.send({ url });
    },
  );
};

import type { FastifyPluginAsync } from 'fastify';
import { listIntegrationsRoute } from './list-integrations/list-integrations.controller.js';
import { putIntegrationRoute, type PutIntegrationOptions } from './put-integration/put-integration.controller.js';
import {
  removeIntegrationRoute,
  type RemoveIntegrationOptions,
} from './remove-integration/remove-integration.controller.js';
import { googleAuthorizeRoute } from './google-authorize/google-authorize.controller.js';
import {
  googlePropertiesRoute,
  type GooglePropertiesOptions,
} from './google-properties/google-properties.controller.js';
import { selectPropertyRoute, type SelectPropertyOptions } from './select-property/select-property.controller.js';
import { socialConnectUrlRoute } from './social-connect-url/social-connect-url.controller.js';
import { socialAccountsRoute } from './social-accounts/social-accounts.controller.js';
import { disconnectSocialAccountRoute } from './disconnect-social-account/disconnect-social-account.controller.js';
import type { SocialRoutesOptions } from './social-accounts.service.js';

export type IntegrationsRoutesOptions = PutIntegrationOptions &
  GooglePropertiesOptions &
  SelectPropertyOptions &
  RemoveIntegrationOptions &
  SocialRoutesOptions;

/**
 * Registers the integration routes. Auth + tenant resolution are applied by
 * the caller (`app.ts`), not here: the test registers this plugin directly
 * against a bare Fastify instance that has no `authenticate`/`resolveTenant`
 * decorators, only a plain `req.tenant` hook — the same shape as
 * `uploadRoute`, which app.ts wraps in its own scope for the same reason.
 */
export const integrationsRoutes: FastifyPluginAsync<IntegrationsRoutesOptions> = async (app, opts) => {
  await app.register(listIntegrationsRoute);
  // O verificador viaja como opção para o teste poder substituir a chamada real
  // à fonte. Sem opção, o verificador real é usado.
  await app.register(putIntegrationRoute, { verify: opts.verify });
  // Listagem, verificação e revogação entram por opção pela mesma razão: sem
  // elas, um teste do DELETE ou da escolha de property sairia falando com o
  // Google de dentro da suíte.
  await app.register(removeIntegrationRoute, { revoke: opts.revoke });
  await app.register(googleAuthorizeRoute);
  await app.register(googlePropertiesRoute, { list: opts.list });
  await app.register(selectPropertyRoute, { check: opts.check });
  // As três do provider social. O cliente entra por `opts.social` pela mesma
  // razão de todas as outras: sem ele, um teste sairia falando com o provider
  // de dentro da suíte.
  await app.register(socialConnectUrlRoute, { social: opts.social });
  await app.register(socialAccountsRoute, { social: opts.social });
  await app.register(disconnectSocialAccountRoute, { social: opts.social });
};

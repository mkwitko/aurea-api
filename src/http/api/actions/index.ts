import type { FastifyPluginAsync } from 'fastify';
import { createActionRoute } from './create-action/create-action.controller.js';
import { listActionsRoute } from './list-actions/list-actions.controller.js';
import { listCapabilitiesRoute } from './list-capabilities/list-capabilities.controller.js';
import { getActionRoute } from './get-action/get-action.controller.js';
import { updateActionRoute } from './update-action/update-action.controller.js';
import { submitActionRoute } from './submit-action/submit-action.controller.js';
import { approveActionRoute } from './approve-action/approve-action.controller.js';
import { rejectActionRoute } from './reject-action/reject-action.controller.js';
import { cancelActionRoute } from './cancel-action/cancel-action.controller.js';
import { executeActionRoute, type ExecuteActionOptions } from './execute-action/execute-action.controller.js';
import { resolveTargetRoute } from './resolve-target/resolve-target.controller.js';
import type { SocialRoutesOptions } from '../integrations/social-accounts.service.js';

export type ActionsRoutesOptions = SocialRoutesOptions & ExecuteActionOptions;

/**
 * Registra as rotas de ações. Auth e tenant são aplicados pelo chamador
 * (`app.ts`), não aqui: o teste registra este plugin contra um Fastify nu que
 * não tem os decorators, só um hook que põe `req.tenant` — mesma forma de
 * `integrationsRoutes`.
 */
export const actionsRoutes: FastifyPluginAsync<ActionsRoutesOptions> = async (app, opts) => {
  // O cliente social viaja como opção para o teste poder substituir a chamada
  // real: criar e editar validam as redes contra as contas conectadas ao vivo.
  // Sem opção, o cliente real é usado.
  await app.register(createActionRoute, { social: opts.social });
  await app.register(listActionsRoute);
  // Antes de `getActionRoute`: `/actions/capabilities` é literal e `/actions/:id`
  // casaria com ela se viesse primeiro. O Fastify prefere a rota estática, mas a
  // ordem aqui deixa a intenção explícita em vez de depender disso.
  await app.register(listCapabilitiesRoute);
  await app.register(getActionRoute);
  await app.register(updateActionRoute, { social: opts.social });
  await app.register(submitActionRoute);
  await app.register(approveActionRoute);
  await app.register(rejectActionRoute);
  await app.register(cancelActionRoute);
  await app.register(executeActionRoute, { enqueue: opts.enqueue });
  await app.register(resolveTargetRoute);
};

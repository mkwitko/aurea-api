import type { FastifyPluginAsync } from 'fastify';
import { createWorkspaceRoute } from './create-workspace/create-workspace.controller.js';
import { listWorkspacesRoute } from './list-workspaces/list-workspaces.controller.js';

/**
 * Registers all `workspaces` routes. Auth is applied at this scope; a tenant is
 * NOT — as duas rotas precisam de tenants diferentes. Criar o primeiro
 * workspace é o único caminho de quem não tem nenhum (resolveOrgTenant);
 * listar exige um workspace de verdade (resolveTenant). Cada controller
 * declara o seu.
 */
export const workspacesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  await app.register(listWorkspacesRoute);
  await app.register(createWorkspaceRoute);
};

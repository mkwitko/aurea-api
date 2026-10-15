import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createWorkspaceForOrg } from '../../../../billing/create-workspace.js';
import { assertAdmin } from '../../../../lib/tenant.js';
import { createWorkspaceBody, workspaceResponse } from '../workspaces.schema.js';
import { presentWorkspace } from '../workspaces.presenter.js';

export const createWorkspaceRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/workspaces',
    {
      preHandler: [app.resolveOrgTenant],
      schema: {
        tags: ['workspaces'],
        operationId: 'createWorkspace',
        body: createWorkspaceBody,
        response: { 201: workspaceResponse },
      },
    },
    async (req, reply) => {
      // orgTenant e não tenant: esta é a rota que o usuário sem workspace
      // precisa alcançar, e resolveTenant recusaria o request dele.
      assertAdmin(req.orgTenant);

      // O teto do plano é verificado dentro da mesma transação do insert, com
      // a linha da organização travada (ver createWorkspaceForOrg): fora dela,
      // duas criações concorrentes passam do teto ao mesmo tempo.
      const workspace = await createWorkspaceForOrg(app.prisma, req.orgTenant.organizationId, {
        name: req.body.name,
        creatorUserId: req.orgTenant.userId,
        creatorRole: req.orgTenant.role,
      });

      // Nenhum crédito de boas-vindas aqui: o trial é da organização, acontece
      // uma vez e vai para o primeiro workspace dela (createWorkspaceForOrg).
      // Este workspace já recebe a franquia do plano.
      return reply.code(201).send(presentWorkspace(workspace));
    },
  );
};

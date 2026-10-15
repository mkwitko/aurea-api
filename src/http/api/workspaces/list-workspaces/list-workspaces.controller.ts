import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { workspaceListResponse } from '../workspaces.schema.js';
import { presentWorkspace } from '../workspaces.presenter.js';

export const listWorkspacesRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/workspaces',
    {
      preHandler: [app.resolveTenant],
      schema: { tags: ['workspaces'], operationId: 'listWorkspaces', response: { 200: workspaceListResponse } },
    },
    async (req, reply) => {
      // Sem paginação de propósito: o teto do plano limita a lista a 10 (SCALE),
      // e paginar dez linhas é complexidade sem cliente.
      //
      // Só os workspaces em que o usuário tem membership: pertencer à
      // organização não dá acesso a todo workspace dela.
      const rows = await app.prisma.workspace.findMany({
        where: {
          organizationId: req.tenant.organizationId,
          deletedAt: null,
          status: 'ACTIVE',
          memberships: { some: { userId: req.tenant.userId } },
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, slug: true, createdAt: true },
      });

      return reply.send({ workspaces: rows.map(presentWorkspace) });
    },
  );
};

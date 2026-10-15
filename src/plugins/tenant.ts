import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';
import { assertWriter } from '../lib/tenant.js';

/**
 * Refuses any unsafe method for a read-only role.
 *
 * Registered per module as a hook rather than called per controller on purpose:
 * a hook covers every route in that module, including the ones not written yet,
 * while a per-route call is one the next route forgets — which is exactly how
 * every domain module ended up writable by a VIEWER.
 *
 * Method-based, not route-based: GET/HEAD/OPTIONS are the safe methods by
 * definition, so there is no list to keep in sync. Exported so tests use this
 * implementation rather than a copy of it.
 */
export async function denyReadOnly(request: FastifyRequest, _reply?: FastifyReply): Promise<void> {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return;
  assertWriter(request.tenant);
}

// Resolves the tenant context for a request. Must run after `authenticate`.
// Workspace is taken from the `x-workspace-id` header, or defaults to the
// user's first workspace membership. Membership is always verified — a user
// can only act inside a workspace they belong to.
//
// resolveOrgTenant resolve só a organização, para a rota que cria o primeiro
// workspace — a única que um usuário sem workspace precisa alcançar.
export default fp(async function tenantPlugin(app: FastifyInstance) {
  app.decorate('resolveTenant', async function (request: FastifyRequest, _reply: FastifyReply) {
    const userId = request.user?.sub;
    if (!userId) throw new UnauthorizedError('Not authenticated');

    const requested = request.headers['x-workspace-id'];
    const workspaceId = Array.isArray(requested) ? requested[0] : requested;

    const membership = await app.prisma.membership.findFirst({
      where: {
        userId,
        workspaceId: workspaceId ? workspaceId : { not: null },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!membership || !membership.workspaceId) {
      throw new ForbiddenError('No access to the requested workspace');
    }

    request.tenant = {
      userId,
      organizationId: membership.organizationId,
      workspaceId: membership.workspaceId,
      role: membership.role,
    };
  });

  // O tenant de quem ainda não tem workspace, para POST /workspaces criar o
  // primeiro. resolveTenant continua recusando esse request — e está certo:
  // toda rota de domínio precisa de um workspace, e 403 lá é a resposta.
  //
  // Mesmo `orderBy: { createdAt: 'asc' }` do resolveTenant e do
  // auth.repository.userById: as três leituras têm que escolher a MESMA
  // membership, senão o papel que o front mostra não é o que o backend
  // aplica.
  app.decorate('resolveOrgTenant', async function (request: FastifyRequest, _reply: FastifyReply) {
    const userId = request.user?.sub;
    if (!userId) throw new UnauthorizedError('Not authenticated');

    const membership = await app.prisma.membership.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });

    if (!membership) throw new ForbiddenError('No access to the requested workspace');

    request.orgTenant = {
      userId,
      organizationId: membership.organizationId,
      role: membership.role,
    };
  });

  app.decorate('denyReadOnly', denyReadOnly);
});

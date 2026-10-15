import { type PrismaClient, Role } from '@prisma/client';
import { uniqueSlug } from '../../../lib/slug.js';

export function createAuthRepository(prisma: PrismaClient) {
  return {
    userByEmail(email: string) {
      return prisma.user.findUnique({ where: { email } });
    },
    userById(id: string) {
      // orderBy tem que concordar com o `orderBy: { createdAt: 'asc' }` que
      // src/plugins/tenant.ts usa para resolver o tenant: sem os dois lidos na
      // mesma ordem, o front deriva o papel atuante da PRIMEIRA membership que
      // /auth/me devolve, e o backend resolve o tenant pela primeira que o
      // Postgres devolver para tenant.ts — sem ORDER BY o Postgres não garante
      // ordem nenhuma, então as duas podiam divergir (um OWNER via tudo
      // desabilitado, um VIEWER ganhando um botão que dá 403).
      return prisma.user.findUnique({
        where: { id },
        include: { memberships: { orderBy: { createdAt: 'asc' } } },
      });
    },
    createAccount(input: { name: string; email: string; passwordHash: string; organizationName: string }) {
      return prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: { name: input.organizationName, slug: uniqueSlug(input.organizationName) },
        });
        const user = await tx.user.create({
          data: { email: input.email, name: input.name, passwordHash: input.passwordHash },
        });
        // Membership de organização, sem workspace: o registro não cria mais um
        // workspace 'Default' que ninguém escolheu. O primeiro workspace — e com
        // ele o trial — nasce em createWorkspaceForOrg, quando o usuário
        // finalmente dá um nome à empresa ou marca dele.
        //
        // Membership.workspaceId é nullable no schema e /auth/me já devolve
        // null nele, então a sessão continua reportando OWNER: o web deriva o
        // papel atuante da primeira membership quando nenhuma tem workspace
        // (web/src/lib/auth.tsx).
        await tx.membership.create({
          data: { userId: user.id, organizationId: organization.id, workspaceId: null, role: Role.OWNER },
        });
        return user;
      });
    },
    createRefreshToken(userId: string, tokenHash: string, expiresAt: Date) {
      return prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
    },
    findRefreshToken(tokenHash: string) {
      return prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
    },
    revokeRefreshToken(id: string) {
      return prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
    },
    revokeByHash(tokenHash: string) {
      return prisma.refreshToken.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } });
    },
  };
}

export type AuthRepository = ReturnType<typeof createAuthRepository>;

import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.js';
import tenantPlugin from './tenant.js';

function buildApp(membership: unknown) {
  const findFirst = vi.fn().mockResolvedValue(membership);
  const app = Fastify();
  app.decorate('prisma', { membership: { findFirst } } as never);
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
    throw error;
  });
  return { app, findFirst };
}

async function withRoute(membership: unknown) {
  const { app, findFirst } = buildApp(membership);
  await app.register(tenantPlugin);
  let seen: unknown;
  app.get('/probe', { preHandler: [app.resolveOrgTenant] }, async (req: FastifyRequest) => {
    seen = req.orgTenant;
    return { ok: true };
  });
  // `authenticate` normally puts this there; resolveOrgTenant only reads it.
  app.addHook('onRequest', async (req) => {
    (req as { user?: unknown }).user = { sub: 'u1', email: 'a@b.com' };
  });
  return { app, findFirst, seen: () => seen };
}

describe('resolveOrgTenant', () => {
  // O usuário recém-registrado tem membership de organização e nenhum
  // workspace. É exatamente ele que precisa criar o primeiro.
  it('resolves an organization-level membership', async () => {
    const probe = await withRoute({ userId: 'u1', organizationId: 'org-1', workspaceId: null, role: 'OWNER' });

    const res = await probe.app.inject({ method: 'GET', url: '/probe' });

    expect(res.statusCode).toBe(200);
    expect(probe.seen()).toEqual({ userId: 'u1', organizationId: 'org-1', role: 'OWNER' });
  });

  it('reads the oldest membership, the same one resolveTenant and /auth/me use', async () => {
    const probe = await withRoute({ userId: 'u1', organizationId: 'org-1', workspaceId: null, role: 'OWNER' });

    await probe.app.inject({ method: 'GET', url: '/probe' });

    expect(probe.findFirst).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('refuses a user with no membership at all', async () => {
    const probe = await withRoute(null);

    const res = await probe.app.inject({ method: 'GET', url: '/probe' });

    expect(res.statusCode).toBe(403);
  });
});

describe('resolveTenant', () => {
  // A contrapartida: o tenant de workspace continua recusando quem não tem
  // workspace. Toda rota de domínio é escopada por workspaceId, e afrouxar isto
  // para acomodar a conta recém-registrada abriria consulta sem escopo.
  it('still refuses an account whose only membership is organization-level', async () => {
    // `null`, porque é o que o Postgres devolve: a query do resolveTenant filtra
    // `workspaceId: { not: null }` quando não vem header, e a única membership
    // desta conta tem workspaceId null — nenhuma linha casa.
    const { app, findFirst } = buildApp(null);
    await app.register(tenantPlugin);
    app.addHook('onRequest', async (req) => {
      (req as { user?: unknown }).user = { sub: 'u1', email: 'a@b.com' };
    });
    app.get('/domain', { preHandler: [app.resolveTenant] }, async () => ({ ok: true }));

    const res = await app.inject({ method: 'GET', url: '/domain' });

    expect(res.statusCode).toBe(403);
    // Não basta o fake devolver `null` para qualquer consulta: sem esta
    // asserção o teste passaria do mesmo jeito se `workspaceId: { not: null }`
    // fosse apagado da query real, que é exatamente o que ele diz proteger.
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: 'u1', workspaceId: { not: null } },
      orderBy: { createdAt: 'asc' },
    });
  });
});

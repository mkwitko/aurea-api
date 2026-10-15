import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../lib/errors.js';
import { createWorkspaceRoute } from './create-workspace/create-workspace.controller.js';
import { listWorkspacesRoute } from './list-workspaces/list-workspaces.controller.js';

const CREATED = {
  id: 'ws-2',
  name: 'Growth',
  slug: 'growth-a1b2c3',
  createdAt: new Date('2026-07-28T00:00:00Z'),
};

// O client de fora da transação e o client de dentro dela (`tx`) usam mocks
// distintos de propósito: se o controller regredisse para inserir pelo client
// de fora, `txWorkspaceCreate` ficaria sem chamada e `outerWorkspaceCreate`
// pegaria a chamada — os dois asserts abaixo (Finding 2) pegam essa regressão.
function prismaFake(options: { plan?: 'STARTER' | 'GROWTH' | 'SCALE'; workspaceCount?: number } = {}) {
  const outerWorkspaceCreate = vi.fn().mockResolvedValue({ id: 'wrong-path', name: 'wrong', slug: 'wrong', createdAt: new Date() });
  const outerMembershipCreate = vi.fn().mockResolvedValue({});
  const txWorkspaceCreate = vi.fn().mockResolvedValue(CREATED);
  const txMembershipCreate = vi.fn().mockResolvedValue({});
  const txOrganizationFindUnique = vi.fn().mockResolvedValue({ id: 'org-1', plan: options.plan ?? 'GROWTH' });
  const txWorkspaceCount = vi.fn().mockResolvedValue(options.workspaceCount ?? 1);
  const txQueryRaw = vi.fn().mockResolvedValue([]);
  const findMany = vi.fn().mockResolvedValue([CREATED]);
  const txCreditLedgerCreate = vi.fn().mockResolvedValue({});

  return {
    workspace: {
      create: outerWorkspaceCreate,
      findMany,
    },
    membership: { create: outerMembershipCreate, findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        $queryRaw: txQueryRaw,
        organization: { findUnique: txOrganizationFindUnique },
        workspace: { create: txWorkspaceCreate, count: txWorkspaceCount },
        membership: { create: txMembershipCreate },
        creditLedger: { create: txCreditLedgerCreate },
      }),
    ),
    // Expostos só para os asserts dos testes de baixo; nunca lidos pelo
    // código de produção.
    _outer: { workspaceCreate: outerWorkspaceCreate, membershipCreate: outerMembershipCreate },
    _tx: {
      workspaceCreate: txWorkspaceCreate,
      membershipCreate: txMembershipCreate,
      queryRaw: txQueryRaw,
    },
    _findMany: findMany,
  };
}

async function buildTestApp(role: 'OWNER' | 'ADMIN' | 'MEMBER' = 'OWNER', prisma = prismaFake()) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prisma as never);
  // As rotas declaram seu próprio preHandler (resolveOrgTenant/resolveTenant),
  // que este app de teste não registra via tenantPlugin; um no-op basta, já
  // que o hook abaixo já preenche req.tenant/req.orgTenant.
  app.decorate('resolveOrgTenant', async () => {});
  app.decorate('resolveTenant', async () => {});
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: 'ws-1', role };
    // A rota de criação lê daqui: quem cria o primeiro workspace não tem
    // workspace nenhum, então ela não pode depender de `tenant`.
    req.orgTenant = { userId: 'u1', organizationId: 'org-1', role };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, details: error.details } });
    }
    throw error;
  });
  await app.register(createWorkspaceRoute);
  await app.register(listWorkspacesRoute);
  return app;
}

describe('POST /workspaces', () => {
  it('creates a workspace and makes the caller a member of it', async () => {
    const prisma = prismaFake({ plan: 'GROWTH', workspaceCount: 1 });
    const app = await buildTestApp('OWNER', prisma);

    const res = await app.inject({ method: 'POST', url: '/workspaces', payload: { name: 'Growth' } });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id: 'ws-2', name: 'Growth' });
    expect(prisma.$transaction).toHaveBeenCalled();

    // O insert tem que passar pelo client da transação, nunca pelo de fora
    // dela — só assim workspace e membership commitam juntos.
    expect(prisma._tx.workspaceCreate).toHaveBeenCalled();
    expect(prisma._outer.workspaceCreate).not.toHaveBeenCalled();

    // Sem este insert o workspace criado não tem membro nenhum e fica
    // invisível para o resolveTenant — é a propriedade que este teste promete.
    expect(prisma._tx.membershipCreate).toHaveBeenCalledWith({
      data: { userId: 'u1', organizationId: 'org-1', workspaceId: 'ws-2', role: 'OWNER' },
    });
    expect(prisma._outer.membershipCreate).not.toHaveBeenCalled();
  });

  it('blocks at the plan cap with the numbers in the error', async () => {
    const app = await buildTestApp('OWNER', prismaFake({ plan: 'STARTER', workspaceCount: 1 }));

    const res = await app.inject({ method: 'POST', url: '/workspaces', payload: { name: 'Second' } });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatchObject({ code: 'AUR-T0017', details: { current: 1, max: 1 } });
  });

  it('refuses a MEMBER', async () => {
    const app = await buildTestApp('MEMBER');
    const res = await app.inject({ method: 'POST', url: '/workspaces', payload: { name: 'Growth' } });
    expect(res.statusCode).toBe(403);
  });

  it('rejects an empty name', async () => {
    const app = await buildTestApp('OWNER');
    const res = await app.inject({ method: 'POST', url: '/workspaces', payload: { name: '  ' } });
    expect(res.statusCode).toBe(400);
  });

  it('creates a workspace for a user who has no workspace yet', async () => {
    const prisma = prismaFake({ workspaceCount: 0 });
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('prisma', prisma as never);
    // A rota declara seu próprio preHandler (resolveOrgTenant); um no-op
    // basta aqui, já que o hook abaixo já preenche req.orgTenant.
    app.decorate('resolveOrgTenant', async () => {});
    // `tenant` deliberadamente ausente: é o estado real de quem acabou de se
    // registrar. Se o controller voltar a lê-lo, isto estoura.
    app.addHook('preHandler', async (req) => {
      req.orgTenant = { userId: 'u1', organizationId: 'org-1', role: 'OWNER' };
    });
    app.setErrorHandler((error, _req, reply) => {
      if (error instanceof AppError) {
        return reply.status(error.statusCode).send({ error: { code: error.code, details: error.details } });
      }
      throw error;
    });
    await app.register(createWorkspaceRoute);

    const res = await app.inject({ method: 'POST', url: '/workspaces', payload: { name: 'Growth' } });

    expect(res.statusCode).toBe(201);
    expect(prisma._tx.workspaceCreate).toHaveBeenCalled();
  });
});

describe('GET /workspaces', () => {
  it('lists the workspaces of the caller organization', async () => {
    const prisma = prismaFake();
    const app = await buildTestApp('MEMBER', prisma);

    const res = await app.inject({ method: 'GET', url: '/workspaces' });

    expect(res.statusCode).toBe(200);
    expect(res.json().workspaces[0]).toMatchObject({ id: 'ws-2', name: 'Growth' });

    // Pino contra a regressão que o Finding 3 aponta: sem o filtro de
    // membership, pertencer à organização já bastaria para listar workspace
    // de outro membro.
    expect(prisma._findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-1',
          memberships: { some: { userId: 'u1' } },
        }),
      }),
    );
  });
});

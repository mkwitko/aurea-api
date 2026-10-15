import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../lib/errors.js';
import { seal } from '../../../billing/crypto.js';
import { integrationsRoutes } from './index.js';

const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';
const CREDENTIAL = JSON.stringify({ client_email: 'aurea@project.iam.gserviceaccount.com', private_key: 'pk' });
// `ROW.ciphertext/iv/authTag` abaixo são bytes de mentira — nunca decifrados
// pelos testes de GET/PUT/DELETE existentes. A revogação decifra de verdade
// (`openIntegrationCredential`), então os testes de OAuth precisam de uma
// credencial selada de verdade, ou a revogação nunca seria chamada — o
// decrypt falharia antes, em silêncio, dentro do `try/catch` melhor-esforço.
const OAUTH_SEALED = seal(JSON.stringify({ refresh_token: 'rt' }));

const ROW = {
  id: 'int-1',
  workspaceId: WORKSPACE_ID,
  provider: 'GA4',
  authKind: 'SERVICE_ACCOUNT',
  ciphertext: Buffer.from('cipher'),
  iv: Buffer.from('iv'),
  authTag: Buffer.from('tag'),
  externalId: '123456789',
  accountLabel: 'aurea@project.iam.gserviceaccount.com',
  status: 'OK',
  lastCheckedAt: new Date('2026-08-04T00:00:00.000Z'),
  lastError: null,
  createdBy: 'u1',
  createdAt: new Date('2026-08-04T00:00:00.000Z'),
  updatedAt: new Date('2026-08-04T00:00:00.000Z'),
};

const prismaFake = () => ({
  workspaceIntegration: {
    findMany: vi.fn().mockResolvedValue([ROW]),
    findFirst: vi.fn().mockResolvedValue(ROW),
    upsert: vi.fn().mockResolvedValue(ROW),
    update: vi.fn().mockResolvedValue(ROW),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
});

beforeEach(() => vi.clearAllMocks());

/**
 * Um verificador que nunca sai da máquina. Passado por opção de plugin, e não
 * por decorator: assim é impossível um teste esquecer de substituí-lo e sair
 * chamando o Google de dentro da suíte.
 */
const acceptingVerify = (accountLabel = 'aurea@project.iam.gserviceaccount.com') =>
  vi.fn().mockResolvedValue({ ok: true as const, accountLabel });

const refusingVerify = (reason: string) => vi.fn().mockResolvedValue({ ok: false as const, reason });

async function buildApp(
  prisma: unknown,
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' = 'ADMIN',
  verify: ReturnType<typeof acceptingVerify> = acceptingVerify(),
  revoke?: ReturnType<typeof vi.fn>,
) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prisma as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: WORKSPACE_ID, role };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
    throw error;
  });
  await app.register(integrationsRoutes, { verify, revoke });
  return app;
}

describe('GET /integrations', () => {
  it('lista o que está conectado sem devolver o segredo', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({ method: 'GET', url: '/integrations' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.integrations[0]).toMatchObject({
      provider: 'GA4',
      authKind: 'SERVICE_ACCOUNT',
      externalId: '123456789',
      accountLabel: 'aurea@project.iam.gserviceaccount.com',
      status: 'OK',
    });
    // A trava que importa: um `select` acrescentado sem cuidado vazaria a chave
    // do cliente numa resposta HTTP.
    const raw = res.body;
    expect(raw).not.toContain('cipher');
    expect(raw).not.toContain('private_key');
    expect(Object.keys(body.integrations[0])).not.toContain('ciphertext');
  });

  it('lê apenas dentro do workspace do tenant', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    await app.inject({ method: 'GET', url: '/integrations' });

    expect(prisma.workspaceIntegration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: WORKSPACE_ID } }),
    );
  });
});

describe('PUT /integrations', () => {
  const body = {
    provider: 'GA4',
    authKind: 'SERVICE_ACCOUNT',
    externalId: '123456789',
    credentials: CREDENTIAL,
  };

  // Verificar antes de gravar, como provider-key já faz: credencial errada
  // aceita em silêncio só apareceria como medição falhando dias depois.
  it('verifica a credencial contra a fonte antes de gravar', async () => {
    const prisma = prismaFake();
    const verify = acceptingVerify();
    const app = await buildApp(prisma, 'ADMIN', verify);

    const res = await app.inject({ method: 'PUT', url: '/integrations', payload: body });

    expect(res.statusCode).toBe(200);
    expect(verify).toHaveBeenCalled();
    expect(prisma.workspaceIntegration.upsert).toHaveBeenCalled();
  });

  it('recusa e não grava quando a fonte rejeita a credencial', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma, 'ADMIN', refusingVerify('Caller does not have permission.'));

    const res = await app.inject({ method: 'PUT', url: '/integrations', payload: body });

    expect(res.statusCode).toBe(400);
    expect(prisma.workspaceIntegration.upsert).not.toHaveBeenCalled();
  });

  it('grava com o workspace do tenant, ignorando qualquer id no corpo', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma, 'ADMIN', acceptingVerify('x'));

    await app.inject({
      method: 'PUT',
      url: '/integrations',
      payload: { ...body, workspaceId: '00000000-0000-0000-0000-000000000000' },
    });

    const args = prisma.workspaceIntegration.upsert.mock.calls[0]![0] as { create: { workspaceId: string } };
    expect(args.create.workspaceId).toBe(WORKSPACE_ID);
  });

  it('nega para quem não é admin', async () => {
    const app = await buildApp(prismaFake(), 'MEMBER');

    expect((await app.inject({ method: 'PUT', url: '/integrations', payload: body })).statusCode).toBe(403);
  });
});

describe('DELETE /integrations', () => {
  it('remove só dentro do workspace', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    const res = await app.inject({ method: 'DELETE', url: '/integrations?provider=GA4' });

    expect(res.statusCode).toBe(204);
    expect(prisma.workspaceIntegration.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, provider: 'GA4' },
    });
  });

  it('nega para quem não é admin', async () => {
    const app = await buildApp(prismaFake(), 'VIEWER');

    expect((await app.inject({ method: 'DELETE', url: '/integrations?provider=GA4' })).statusCode).toBe(403);
  });

  it('revoga a credencial no Google antes de apagar uma conexão OAuth', async () => {
    const revoke = vi.fn().mockResolvedValue(undefined);
    const prisma = prismaFake();
    prisma.workspaceIntegration.findFirst.mockResolvedValue({
      ...ROW,
      authKind: 'OAUTH',
      ciphertext: new Uint8Array(OAUTH_SEALED.ciphertext),
      iv: new Uint8Array(OAUTH_SEALED.iv),
      authTag: new Uint8Array(OAUTH_SEALED.authTag),
    });
    const app = await buildApp(prisma, 'ADMIN', acceptingVerify(), revoke);

    const res = await app.inject({ method: 'DELETE', url: '/integrations?provider=GA4' });

    expect(res.statusCode).toBe(204);
    expect(revoke).toHaveBeenCalled();
    expect(prisma.workspaceIntegration.deleteMany).toHaveBeenCalled();
  });

  // O que ele pediu foi parar de usar. Uma falha do Google não pode segurar a
  // remoção.
  it('apaga mesmo quando a revogação falha', async () => {
    const revoke = vi.fn().mockRejectedValue(new Error('invalid_token'));
    const prisma = prismaFake();
    prisma.workspaceIntegration.findFirst.mockResolvedValue({
      ...ROW,
      authKind: 'OAUTH',
      ciphertext: new Uint8Array(OAUTH_SEALED.ciphertext),
      iv: new Uint8Array(OAUTH_SEALED.iv),
      authTag: new Uint8Array(OAUTH_SEALED.authTag),
    });
    const app = await buildApp(prisma, 'ADMIN', acceptingVerify(), revoke);

    expect((await app.inject({ method: 'DELETE', url: '/integrations?provider=GA4' })).statusCode).toBe(204);
    expect(revoke).toHaveBeenCalled();
    expect(prisma.workspaceIntegration.deleteMany).toHaveBeenCalled();
  });

  it('não tenta revogar uma service account', async () => {
    const revoke = vi.fn();
    const app = await buildApp(prismaFake(), 'ADMIN', acceptingVerify(), revoke);

    await app.inject({ method: 'DELETE', url: '/integrations?provider=GA4' });

    expect(revoke).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../lib/errors.js';
import { seal } from '../../../billing/crypto.js';
import { googlePropertiesRoute } from './google-properties/google-properties.controller.js';
import { selectPropertyRoute } from './select-property/select-property.controller.js';

const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';
const SEALED = seal(JSON.stringify({ refresh_token: 'rt' }));

const ROW = {
  id: 'int-1',
  workspaceId: WORKSPACE_ID,
  provider: 'GA4',
  // SERVICE_ACCOUNT, e não OAUTH: as duas rotas deste arquivo funcionam para
  // os dois `authKind` (ver o comentário em `google-properties.controller.ts`),
  // e SERVICE_ACCOUNT evita exigir as três `GOOGLE_OAUTH_*` no ambiente do
  // teste — `minterFor('OAUTH', ...)` validaria isso antes mesmo de chamar o
  // `list`/`check` injetado, e este arquivo não stub-a o env como
  // `ga4-minter.test.ts` e `google-authorize.test.ts` fazem.
  authKind: 'SERVICE_ACCOUNT',
  ciphertext: new Uint8Array(SEALED.ciphertext),
  iv: new Uint8Array(SEALED.iv),
  authTag: new Uint8Array(SEALED.authTag),
  externalId: null,
  accountLabel: 'founder@acme.com',
  status: 'UNVERIFIED',
  lastCheckedAt: new Date('2026-08-04T00:00:00Z'),
  lastError: null,
  // `integrationSchema` exige `createdAt`; sem ele a resposta do PUT falha na
  // serialização (500), não na asserção.
  createdAt: new Date('2026-08-04T00:00:00Z'),
};

const update = vi.fn();

/** `'integration' in over`, não `??`: o caso "sem integração" passa `null`. */
function prismaFake(over: { integration?: unknown } = {}) {
  return {
    workspaceIntegration: {
      findFirst: vi.fn().mockResolvedValue('integration' in over ? over.integration : ROW),
      update: update.mockResolvedValue({ ...ROW, externalId: '123456789', status: 'OK' }),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

const PROPERTIES = {
  properties: [{ propertyId: '123456789', displayName: 'Site institucional', accountName: 'Acme Inc' }],
  truncated: false,
};

async function buildApp(
  prisma: unknown,
  deps: {
    list?: ReturnType<typeof vi.fn>;
    check?: ReturnType<typeof vi.fn>;
    role?: 'ADMIN' | 'MEMBER';
  } = {},
) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prisma as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: WORKSPACE_ID, role: deps.role ?? 'ADMIN' };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
    throw error;
  });
  // Listagem e verificação entram por opção: sem isso a suíte chamaria o
  // Google.
  await app.register(googlePropertiesRoute, { list: deps.list ?? vi.fn().mockResolvedValue(PROPERTIES) });
  await app.register(selectPropertyRoute, { check: deps.check ?? vi.fn().mockResolvedValue({ ok: true }) });
  return app;
}

describe('GET /integrations/google/properties', () => {
  it('lista as properties que a credencial enxerga', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({ method: 'GET', url: '/integrations/google/properties' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(PROPERTIES);
  });

  it('não devolve segredo nenhum', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({ method: 'GET', url: '/integrations/google/properties' });

    expect(res.body).not.toContain('refresh_token');
    expect(res.body).not.toContain('ciphertext');
  });

  it('lê a integração do workspace do tenant', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    await app.inject({ method: 'GET', url: '/integrations/google/properties' });

    expect(prisma.workspaceIntegration.findFirst).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, provider: 'GA4' },
    });
  });

  it('404 quando não há fonte conectada', async () => {
    const app = await buildApp(prismaFake({ integration: null }));

    expect((await app.inject({ method: 'GET', url: '/integrations/google/properties' })).statusCode).toBe(404);
  });

  it('propaga a mensagem da fonte quando a listagem falha', async () => {
    const app = await buildApp(prismaFake(), {
      list: vi.fn().mockRejectedValue(new Error('Caller does not have permission.')),
    });

    const res = await app.inject({ method: 'GET', url: '/integrations/google/properties' });

    expect(res.statusCode).toBe(400);
  });

  it('nega para quem não é admin', async () => {
    const app = await buildApp(prismaFake(), { role: 'MEMBER' });

    expect((await app.inject({ method: 'GET', url: '/integrations/google/properties' })).statusCode).toBe(403);
  });
});

describe('PUT /integrations/google/property', () => {
  const payload = { propertyId: '123456789' };

  it('grava a property e o resultado da verificação', async () => {
    const check = vi.fn().mockResolvedValue({ ok: true });
    const app = await buildApp(prismaFake(), { check });

    const res = await app.inject({ method: 'PUT', url: '/integrations/google/property', payload });

    expect(res.statusCode).toBe(200);
    expect(check).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'int-1' },
        data: expect.objectContaining({ externalId: '123456789', status: 'OK', lastError: null }),
      }),
    );
  });

  // A validação da property é o próprio health(): se a conta não vê aquela
  // property, a leitura falha, e é essa a verdade que interessa.
  it('grava FAILED com a mensagem da fonte quando a property não responde', async () => {
    const app = await buildApp(prismaFake(), {
      check: vi.fn().mockResolvedValue({ ok: false, reason: 'Caller does not have permission.' }),
    });

    const res = await app.inject({ method: 'PUT', url: '/integrations/google/property', payload });

    expect(res.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', lastError: 'Caller does not have permission.' }),
      }),
    );
  });

  it('recusa um propertyId que não é numérico', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({ method: 'PUT', url: '/integrations/google/property', payload: { propertyId: 'G-ABC123' } });

    expect(res.statusCode).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('404 quando não há fonte conectada', async () => {
    const app = await buildApp(prismaFake({ integration: null }));

    expect((await app.inject({ method: 'PUT', url: '/integrations/google/property', payload })).statusCode).toBe(404);
  });

  it('nega para quem não é admin', async () => {
    const app = await buildApp(prismaFake(), { role: 'MEMBER' });

    expect((await app.inject({ method: 'PUT', url: '/integrations/google/property', payload })).statusCode).toBe(403);
  });
});

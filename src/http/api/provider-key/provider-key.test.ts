import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { providerKeyController } from './provider-key.controller.js';
import errorHandlerPlugin from '../../../plugins/error-handler.js';

vi.mock('../../../billing/verify-provider-key.js', () => ({
  verifyProviderKey: vi.fn(async (_provider: string, apiKey: string) => apiKey.startsWith('sk-good')),
}));

function prismaFake(existing: unknown = null) {
  return {
    workspaceProviderKey: {
      findUnique: vi.fn().mockResolvedValue(existing),
      upsert: vi.fn().mockResolvedValue({ last4: '9876', createdAt: new Date('2026-07-01T00:00:00Z') }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

async function buildTestApp(role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER', existing: unknown = null) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', prismaFake(existing) as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'o1', workspaceId: 'ws-1', role };
  });
  await app.register(providerKeyController);
  return app;
}

describe('provider key routes', () => {
  it('reports no key', async () => {
    const app = await buildTestApp('OWNER');
    const res = await app.inject({ method: 'GET', url: '/ai/provider-key' });
    expect(res.json()).toEqual({ configured: false });
  });

  it('stores a verified key and answers with last4 only', async () => {
    const app = await buildTestApp('ADMIN');

    const res = await app.inject({
      method: 'PUT',
      url: '/ai/provider-key',
      payload: { provider: 'deepseek', apiKey: 'sk-good-9876' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ configured: true, last4: '9876' });
    expect(res.payload).not.toContain('sk-good-9876');
  });

  it('rejects a key the provider refuses', async () => {
    const app = await buildTestApp('OWNER');

    const res = await app.inject({
      method: 'PUT',
      url: '/ai/provider-key',
      payload: { provider: 'deepseek', apiKey: 'sk-bad-0000' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AUR-T0014');
  });

  it('denies MEMBER and VIEWER', async () => {
    for (const role of ['MEMBER', 'VIEWER'] as const) {
      const app = await buildTestApp(role);
      expect((await app.inject({ method: 'GET', url: '/ai/provider-key' })).statusCode).toBe(403);
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: '/ai/provider-key',
            payload: { provider: 'deepseek', apiKey: 'sk-good-1111' },
          })
        ).statusCode,
      ).toBe(403);
    }
  });

  it('deletes with 204', async () => {
    const app = await buildTestApp('OWNER');
    expect((await app.inject({ method: 'DELETE', url: '/ai/provider-key?provider=deepseek' })).statusCode).toBe(204);
  });
});

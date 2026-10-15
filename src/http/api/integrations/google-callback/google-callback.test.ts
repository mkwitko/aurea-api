import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../../lib/errors.js';
import { open } from '../../../../billing/crypto.js';
import { signOAuthState } from '../google/oauth-state.js';
import { googleCallbackRoute } from './google-callback.controller.js';

const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_WORKSPACE = '33333333-3333-3333-3333-333333333333';

const upsert = vi.fn();

function prismaFake() {
  return {
    workspaceIntegration: {
      upsert: upsert.mockImplementation(async (args: unknown) => args),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

/**
 * A troca do código entra por opção de plugin. Sem isto o teste chamaria o
 * endpoint de token do Google de dentro da suíte.
 */
const acceptingExchange = (email: string | null = 'founder@acme.com') =>
  vi.fn().mockResolvedValue({ refreshToken: 'rt-secret', email });

async function buildApp(exchange: ReturnType<typeof acceptingExchange>) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prismaFake() as never);
  await app.register(fastifyJwt, { secret: 'a-test-secret-long-enough', sign: { expiresIn: '15m' } });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
    throw error;
  });
  await app.register(googleCallbackRoute, { exchange });
  return app;
}

const url = (params: Record<string, string>) =>
  `/integrations/google/callback?${new URLSearchParams(params).toString()}`;

describe('GET /integrations/google/callback', () => {
  it('sela o refresh token e grava a integração sem property', async () => {
    const app = await buildApp(acceptingExchange());
    const state = signOAuthState(app.jwt, { workspaceId: WORKSPACE_ID, userId: 'u1' });

    const res = await app.inject({ method: 'GET', url: url({ code: 'auth-code', state }) });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('/app/settings/integrations?google=connected');

    const args = upsert.mock.calls[0]![0] as { create: Record<string, unknown> };
    expect(args.create).toMatchObject({
      workspaceId: WORKSPACE_ID,
      provider: 'GA4',
      authKind: 'OAUTH',
      // Autorizado, nenhuma property escolhida: o estado que a Task 2 tornou
      // representável.
      externalId: null,
      status: 'UNVERIFIED',
      accountLabel: 'founder@acme.com',
      createdBy: 'u1',
    });
    // Selado, e recuperável só pela chave de cifra.
    expect(
      open({
        ciphertext: Buffer.from(args.create.ciphertext as Uint8Array),
        iv: Buffer.from(args.create.iv as Uint8Array),
        authTag: Buffer.from(args.create.authTag as Uint8Array),
      }),
    ).toBe(JSON.stringify({ refresh_token: 'rt-secret' }));
  });

  it('nada do Google entra na url de volta', async () => {
    const app = await buildApp(acceptingExchange());
    const state = signOAuthState(app.jwt, { workspaceId: WORKSPACE_ID, userId: 'u1' });

    const res = await app.inject({ method: 'GET', url: url({ code: 'auth-code', state }) });

    const location = res.headers.location as string;
    expect(location).not.toContain('auth-code');
    expect(location).not.toContain('rt-secret');
  });

  // O workspace sai do state assinado. Este teste existe para fixar isso: se
  // alguém trocar por query string, ele quebra.
  it('grava no workspace do state, e em nenhum outro', async () => {
    const app = await buildApp(acceptingExchange());
    const state = signOAuthState(app.jwt, { workspaceId: OTHER_WORKSPACE, userId: 'u9' });

    await app.inject({ method: 'GET', url: url({ code: 'auth-code', state, workspaceId: WORKSPACE_ID }) });

    const args = upsert.mock.calls[0]![0] as { create: Record<string, unknown>; where: unknown };
    expect(args.create.workspaceId).toBe(OTHER_WORKSPACE);
    expect(args.where).toEqual({ workspaceId_provider: { workspaceId: OTHER_WORKSPACE, provider: 'GA4' } });
  });

  it('recusa um state ausente ou inválido, sem gravar e sem redirecionar', async () => {
    const app = await buildApp(acceptingExchange());

    const missing = await app.inject({ method: 'GET', url: url({ code: 'auth-code' }) });
    const garbage = await app.inject({ method: 'GET', url: url({ code: 'auth-code', state: 'not-a-jwt' }) });

    expect(missing.statusCode).toBe(400);
    expect(garbage.statusCode).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('devolve o fundador com erro quando ele recusa o consentimento', async () => {
    const exchange = acceptingExchange();
    const app = await buildApp(exchange);
    const state = signOAuthState(app.jwt, { workspaceId: WORKSPACE_ID, userId: 'u1' });

    const res = await app.inject({ method: 'GET', url: url({ error: 'access_denied', state }) });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('google=error');
    expect(res.headers.location).toContain('reason=access_denied');
    expect(exchange).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  // Vocabulário fechado: o Google devolve o que quiser em `error`, e isso vira
  // query string da nossa própria aplicação.
  it('sanitiza um reason que não é do vocabulário', async () => {
    const app = await buildApp(acceptingExchange());
    const state = signOAuthState(app.jwt, { workspaceId: WORKSPACE_ID, userId: 'u1' });

    const res = await app.inject({
      method: 'GET',
      url: url({ error: '<script>alert(1)</script>', state }),
    });

    expect(res.headers.location).toContain('reason=unknown');
    expect(res.headers.location).not.toContain('script');
  });

  it('não grava quando o Google não devolve refresh token', async () => {
    const app = await buildApp(vi.fn().mockResolvedValue({ refreshToken: null, email: 'founder@acme.com' }));
    const state = signOAuthState(app.jwt, { workspaceId: WORKSPACE_ID, userId: 'u1' });

    const res = await app.inject({ method: 'GET', url: url({ code: 'auth-code', state }) });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('reason=no_refresh_token');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('conecta com rótulo genérico quando o id_token não traz e-mail', async () => {
    const app = await buildApp(acceptingExchange(null));
    const state = signOAuthState(app.jwt, { workspaceId: WORKSPACE_ID, userId: 'u1' });

    await app.inject({ method: 'GET', url: url({ code: 'auth-code', state }) });

    const args = upsert.mock.calls[0]![0] as { create: Record<string, unknown> };
    expect(args.create.accountLabel).toBe('google account');
  });

  it('devolve o fundador com erro quando a troca do código falha', async () => {
    const app = await buildApp(vi.fn().mockRejectedValue(new Error('invalid_grant')));
    const state = signOAuthState(app.jwt, { workspaceId: WORKSPACE_ID, userId: 'u1' });

    const res = await app.inject({ method: 'GET', url: url({ code: 'auth-code', state }) });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('google=error');
    expect(upsert).not.toHaveBeenCalled();
  });
});

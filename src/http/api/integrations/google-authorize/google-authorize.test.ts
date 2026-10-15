import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../../lib/errors.js';

const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** `env.ts` lê `process.env` no import, então o módulo entra depois do stub. */
async function buildApp(oauth: boolean, role: 'ADMIN' | 'MEMBER' = 'ADMIN') {
  vi.resetModules();
  if (oauth) {
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'client-id');
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'client-secret');
    vi.stubEnv('GOOGLE_OAUTH_REDIRECT_URI', 'http://localhost:3000/integrations/google/callback');
  }
  const { googleAuthorizeRoute } = await import('./google-authorize.controller.js');

  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(fastifyJwt, { secret: 'a-test-secret-long-enough', sign: { expiresIn: '15m' } });
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: WORKSPACE_ID, role };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
    throw error;
  });
  await app.register(googleAuthorizeRoute);
  return app;
}

describe('POST /integrations/google/authorize', () => {
  it('devolve a url de consentimento do Google', async () => {
    const app = await buildApp(true);

    const res = await app.inject({ method: 'POST', url: '/integrations/google/authorize' });

    expect(res.statusCode).toBe(200);
    const url = new URL(res.json().url);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    // Offline + consent é o que garante refresh_token: sem ele a conexão morre
    // em uma hora.
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('pede leitura de analytics e nada de escrita', async () => {
    const app = await buildApp(true);

    const url = new URL((await app.inject({ method: 'POST', url: '/integrations/google/authorize' })).json().url);

    const scope = url.searchParams.get('scope') ?? '';
    expect(scope).toContain('https://www.googleapis.com/auth/analytics.readonly');
    expect(scope).not.toContain('analytics.edit');
    expect(scope).not.toContain('analytics.manage');
  });

  it('o state carrega o workspace do tenant', async () => {
    const app = await buildApp(true);

    const url = new URL((await app.inject({ method: 'POST', url: '/integrations/google/authorize' })).json().url);
    const decoded = app.jwt.verify(url.searchParams.get('state') as string) as Record<string, unknown>;

    expect(decoded).toMatchObject({ workspaceId: WORKSPACE_ID, userId: 'u1', purpose: 'google-oauth' });
  });

  it('recusa quando o OAuth não está configurado no ambiente', async () => {
    const app = await buildApp(false);

    const res = await app.inject({ method: 'POST', url: '/integrations/google/authorize' });

    expect(res.statusCode).toBe(400);
  });

  it('nega para quem não é admin', async () => {
    const app = await buildApp(true, 'MEMBER');

    expect((await app.inject({ method: 'POST', url: '/integrations/google/authorize' })).statusCode).toBe(403);
  });
});

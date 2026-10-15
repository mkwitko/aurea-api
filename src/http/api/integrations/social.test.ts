import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../lib/errors.js';
import { seal } from '../../../billing/crypto.js';
import { SocialProviderError } from '../../../integrations/social/index.js';
import { integrationsRoutes } from './index.js';

const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_WORKSPACE_ID = '33333333-3333-3333-3333-333333333333';
const EXTERNAL_ID = `ws-${WORKSPACE_ID}`;

// A chave é da conta AUREA, então o que está selado na linha é um objeto vazio
// (spec de migração §4). Bytes reais, para nenhum `open` acidental falhar antes do
// teste.
const SEALED = seal(JSON.stringify({}));

const ROW = {
  id: 'int-social',
  workspaceId: WORKSPACE_ID,
  provider: 'POST_FOR_ME',
  authKind: 'ACCOUNT_KEY',
  ciphertext: new Uint8Array(SEALED.ciphertext),
  iv: new Uint8Array(SEALED.iv),
  authTag: new Uint8Array(SEALED.authTag),
  externalId: EXTERNAL_ID,
  accountLabel: 'Post for Me',
  status: 'OK',
  lastCheckedAt: new Date('2026-08-05T00:00:00.000Z'),
  lastError: null,
  createdBy: 'u1',
  createdAt: new Date('2026-08-05T00:00:00.000Z'),
  updatedAt: new Date('2026-08-05T00:00:00.000Z'),
};

/**
 * `'integration' in over`, e não `??`: o caso "nunca conectou" passa `null` de
 * propósito, e `??` devolveria a linha default de qualquer jeito — o teste
 * passaria sem que o caminho existisse.
 */
function prismaFake(over: { integration?: unknown } = {}) {
  return {
    workspaceIntegration: {
      findFirst: vi.fn().mockResolvedValue('integration' in over ? over.integration : ROW),
      findMany: vi.fn().mockResolvedValue([ROW]),
      upsert: vi.fn().mockResolvedValue({ ...ROW, ciphertext: undefined, iv: undefined, authTag: undefined }),
      update: vi.fn().mockResolvedValue(ROW),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

const ACCOUNTS = [
  { id: 'acc-li', platform: 'LINKEDIN', username: 'acme', pictureUrl: 'https://img/1', connected: true },
  { id: 'acc-x', platform: 'X', username: 'acme_x', pictureUrl: null, connected: false },
];

/** Um cliente que nunca sai da máquina. Entra por opção de plugin, jamais por decorator. */
function clientFake(over: Record<string, unknown> = {}) {
  return {
    connectUrl: vi.fn().mockResolvedValue({ url: 'https://oauth/linkedin' }),
    listAccounts: vi.fn().mockResolvedValue(ACCOUNTS),
    publish: vi.fn(),
    results: vi.fn(),
    disconnect: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

async function buildApp(
  prisma: unknown,
  opts: {
    role?: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
    social?: ReturnType<typeof clientFake>;
    workspaceId?: string;
  } = {},
) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prisma as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = {
      userId: 'u1',
      organizationId: 'org-1',
      workspaceId: opts.workspaceId ?? WORKSPACE_ID,
      role: opts.role ?? 'ADMIN',
    };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, details: error.details } });
    }
    throw error;
  });
  await app.register(integrationsRoutes, {
    verify: vi.fn().mockResolvedValue({ ok: true, accountLabel: 'ga4' }),
    social: opts.social ? () => opts.social as never : undefined,
  });
  return app;
}

describe('POST /integrations/social/connect-url', () => {
  it('devolve a URL de consentimento da rede pedida', async () => {
    const social = clientFake();
    const app = await buildApp(prismaFake(), { social });

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/social/connect-url',
      payload: { platform: 'LINKEDIN' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ url: 'https://oauth/linkedin' });
    expect(social.connectUrl).toHaveBeenCalledWith(
      { platform: 'LINKEDIN', externalId: EXTERNAL_ID },
      expect.anything(),
    );
  });

  /**
   * O `external_id` amarra a conta autorizada a este cliente, e é a única
   * fronteira que existe: a chave do provider é a mesma para todos
   * (spec de migração §4).
   */
  it('carimba o external_id do workspace do token', async () => {
    const prisma = prismaFake({ integration: null });
    const social = clientFake();
    const app = await buildApp(prisma, { social, workspaceId: OTHER_WORKSPACE_ID });

    await app.inject({
      method: 'POST',
      url: '/integrations/social/connect-url',
      payload: { platform: 'X' },
    });

    expect(social.connectUrl).toHaveBeenCalledWith(
      { platform: 'X', externalId: `ws-${OTHER_WORKSPACE_ID}` },
      expect.anything(),
    );
    expect(prisma.workspaceIntegration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId_provider: { workspaceId: OTHER_WORKSPACE_ID, provider: 'POST_FOR_ME' } },
      }),
    );
  });

  /**
   * Pinterest não está no enum — a credencial não está habilitada na conta do
   * provider, e `auth-url` responderia 404. Pedir por ela é 400 aqui, e não uma
   * conexão que nunca publicaria.
   */
  it('recusa uma rede que a AUREA não publica', async () => {
    const app = await buildApp(prismaFake(), { social: clientFake() });

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/social/connect-url',
      payload: { platform: 'PINTEREST' },
    });

    expect(res.statusCode).toBe(400);
  });

  // As três redes de mídia entraram no enum, então conectar nelas é caminho
  // normal.
  it('aceita conectar nas redes que exigem mídia', async () => {
    for (const platform of ['INSTAGRAM', 'TIKTOK', 'YOUTUBE']) {
      const app = await buildApp(prismaFake(), { social: clientFake() });

      const res = await app.inject({
        method: 'POST',
        url: '/integrations/social/connect-url',
        payload: { platform },
      });

      expect(res.statusCode, platform).toBe(201);
    }
  });

  /**
   * Bluesky não é OAuth: o provider pede `handle` e senha de app, e cria a conta no
   * servidor. As credenciais atravessam a AUREA e não ficam — o que se afirma aqui é
   * que chegam ao conector, e que a resposta não as devolve.
   */
  it('leva handle e senha de app ao conector no Bluesky, e não os devolve', async () => {
    const social = clientFake();
    const app = await buildApp(prismaFake(), { social });

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/social/connect-url',
      payload: { platform: 'BLUESKY', handle: 'acme.bsky.social', appPassword: 'abcd-efgh-ijkl-mnop' },
    });

    expect(res.statusCode).toBe(201);
    expect(social.connectUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'BLUESKY',
        credentials: { handle: 'acme.bsky.social', appPassword: 'abcd-efgh-ijkl-mnop' },
      }),
      expect.anything(),
    );
    expect(res.body).not.toContain('abcd-efgh-ijkl-mnop');
    expect(res.body).not.toContain('acme.bsky.social');
  });

  // Sem as duas não há conexão possível, e o provider responderia `{"url":""}` sem
  // erro — um link vazio que levaria o cliente a lugar nenhum.
  it('recusa Bluesky sem handle ou sem senha de app', async () => {
    const social = clientFake();
    const app = await buildApp(prismaFake(), { social });

    for (const payload of [
      { platform: 'BLUESKY' },
      { platform: 'BLUESKY', handle: 'acme.bsky.social' },
      { platform: 'BLUESKY', appPassword: 'abcd-efgh-ijkl-mnop' },
    ]) {
      const res = await app.inject({ method: 'POST', url: '/integrations/social/connect-url', payload });

      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(social.connectUrl).not.toHaveBeenCalled();
  });

  /**
   * O caminho contrário também é recusado: credencial mandada para uma rede de
   * OAuth não seria usada, e aceitar em silêncio faria alguém acreditar que foi —
   * inclusive alguém tentando enviar senha para onde ela não serve.
   */
  it('recusa credencial numa rede de OAuth', async () => {
    const social = clientFake();
    const app = await buildApp(prismaFake(), { social });

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/social/connect-url',
      payload: { platform: 'LINKEDIN', handle: 'acme', appPassword: 'nao-serve-aqui' },
    });

    expect(res.statusCode).toBe(400);
    expect(social.connectUrl).not.toHaveBeenCalled();
  });

  it('devolve 502 com a mensagem do provider', async () => {
    const social = clientFake({
      connectUrl: vi.fn().mockRejectedValue(new SocialProviderError('PROVIDER', 'upstream is down', 500)),
    });
    const app = await buildApp(prismaFake(), { social });

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/social/connect-url',
      payload: { platform: 'LINKEDIN' },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatchObject({ code: 'AUR-T0048', details: { reason: 'upstream is down' } });
  });

  // Sem `POST_FOR_ME_API_KEY` no ambiente — o caso da suíte e de qualquer
  // instância que não usa publicação social. 503, e não 400: não há nada que o
  // fundador possa corrigir na requisição dele.
  it('responde 503 quando a instância não tem chave', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/social/connect-url',
      payload: { platform: 'LINKEDIN' },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatchObject({ code: 'AUR-T0045' });
  });

  it('recusa MEMBER e VIEWER', async () => {
    for (const role of ['MEMBER', 'VIEWER'] as const) {
      const app = await buildApp(prismaFake(), { social: clientFake(), role });
      const res = await app.inject({
        method: 'POST',
        url: '/integrations/social/connect-url',
        payload: { platform: 'LINKEDIN' },
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it('nunca devolve os bytes selados', async () => {
    const app = await buildApp(prismaFake(), { social: clientFake() });

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/social/connect-url',
      payload: { platform: 'LINKEDIN' },
    });

    expect(res.body).not.toMatch(/ciphertext|authTag|"iv"/);
  });
});

describe('GET /integrations/social/accounts', () => {
  it('devolve as contas, com quem está desconectado', async () => {
    const social = clientFake();
    const app = await buildApp(prismaFake(), { social });

    const res = await app.inject({ method: 'GET', url: '/integrations/social/accounts' });

    expect(res.statusCode).toBe(200);
    expect(res.json().accounts).toEqual(ACCOUNTS);
    expect(social.listAccounts).toHaveBeenCalledWith(EXTERNAL_ID, expect.anything());
  });

  // Nunca ter conectado é estado legítimo, e a tela mostra o caminho.
  it('devolve lista vazia sem nunca ter conectado, sem tocar no provider', async () => {
    const social = clientFake();
    const app = await buildApp(prismaFake({ integration: null }), { social });

    const res = await app.inject({ method: 'GET', url: '/integrations/social/accounts' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accounts: [] });
    expect(social.listAccounts).not.toHaveBeenCalled();
  });

  // Ler quais contas existem é informação de tela, e o formulário de ação depende
  // dela: VIEWER e MEMBER leem.
  it('deixa MEMBER e VIEWER lerem', async () => {
    for (const role of ['MEMBER', 'VIEWER'] as const) {
      const app = await buildApp(prismaFake(), { social: clientFake(), role });
      const res = await app.inject({ method: 'GET', url: '/integrations/social/accounts' });
      expect(res.statusCode).toBe(200);
    }
  });

  it('devolve 502 com a mensagem do provider', async () => {
    const social = clientFake({
      listAccounts: vi.fn().mockRejectedValue(new SocialProviderError('AUTH', 'Unauthorized', 401)),
    });
    const app = await buildApp(prismaFake(), { social });

    const res = await app.inject({ method: 'GET', url: '/integrations/social/accounts' });

    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatchObject({ code: 'AUR-T0048', details: { reason: 'Unauthorized' } });
  });

  /**
   * O provider devolve os tokens do cliente na leitura de contas. Eles param no
   * conector; este teste é a segunda barreira, na fronteira HTTP
   * (spec de migração, risco 3).
   */
  it('nunca devolve token de conta', async () => {
    const social = clientFake({
      listAccounts: vi.fn().mockResolvedValue([
        // O conector já não os devolve; se alguém o "consertar" para espalhar o
        // objeto do provider, este teste cai.
        { ...ACCOUNTS[0], access_token: 'secret-access', refresh_token: 'secret-refresh' },
      ]),
    });
    const app = await buildApp(prismaFake(), { social });

    const res = await app.inject({ method: 'GET', url: '/integrations/social/accounts' });

    expect(res.body).not.toMatch(/secret-access|secret-refresh|access_token|refresh_token/);
  });
});

describe('POST /integrations/social/accounts/:accountId/disconnect', () => {
  it('desconecta a conta do workspace', async () => {
    const social = clientFake();
    const app = await buildApp(prismaFake(), { social });

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/social/accounts/acc-li/disconnect',
    });

    expect(res.statusCode).toBe(204);
    expect(social.disconnect).toHaveBeenCalledWith('acc-li', expect.anything());
  });

  /**
   * Sem a leitura das contas do workspace, um id adivinhado desconectaria a conta
   * de outro cliente — a chave do provider é a mesma para todos.
   */
  it('uma conta que não é do workspace é indistinguível de inexistente', async () => {
    const social = clientFake();
    const app = await buildApp(prismaFake(), { social });

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/social/accounts/acc-de-outro/disconnect',
    });

    expect(res.statusCode).toBe(404);
    expect(social.disconnect).not.toHaveBeenCalled();
  });

  it('sem nada conectado, qualquer id é 404', async () => {
    const social = clientFake();
    const app = await buildApp(prismaFake({ integration: null }), { social });

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/social/accounts/acc-li/disconnect',
    });

    expect(res.statusCode).toBe(404);
    expect(social.disconnect).not.toHaveBeenCalled();
  });

  it('devolve 502 quando o provider recusa', async () => {
    const social = clientFake({
      disconnect: vi.fn().mockRejectedValue(new SocialProviderError('PROVIDER', 'boom', 500)),
    });
    const app = await buildApp(prismaFake(), { social });

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/social/accounts/acc-li/disconnect',
    });

    expect(res.statusCode).toBe(502);
  });

  it('recusa MEMBER e VIEWER', async () => {
    for (const role of ['MEMBER', 'VIEWER'] as const) {
      const app = await buildApp(prismaFake(), { social: clientFake(), role });
      const res = await app.inject({
        method: 'POST',
        url: '/integrations/social/accounts/acc-li/disconnect',
      });
      expect(res.statusCode).toBe(403);
    }
  });
});

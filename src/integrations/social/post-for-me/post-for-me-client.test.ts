import { SocialPlatform } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSocialClient,
  isIndeterminate,
  isRetriable,
  socialExternalId,
  SocialProviderError,
  type SocialFailureKind,
} from './post-for-me-client.js';

const CONFIG = { apiKey: 'k', baseUrl: 'https://api.postforme.dev' };
const EXTERNAL_ID = 'ws-22222222-2222-2222-2222-222222222222';
const signal = () => AbortSignal.timeout(5_000);

type Call = { url: string; init: RequestInit };

function stub(responses: Array<{ status?: number; body?: unknown }>, calls: Call[] = []) {
  let i = 0;
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return Promise.resolve(
      new Response(JSON.stringify(next?.body ?? {}), {
        status: next?.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  return calls;
}

const bodyOf = (call: Call | undefined): Record<string, unknown> =>
  JSON.parse(String(call?.init.body)) as Record<string, unknown>;

afterEach(() => vi.unstubAllGlobals());

describe('socialExternalId', () => {
  // Opaco e derivado do id: o nome do workspace muda, e não é nosso para vazar ao
  // fornecedor (spec §4).
  it('deriva do workspace', () => {
    expect(socialExternalId('abc')).toBe('ws-abc');
  });
});

describe('connectUrl', () => {
  it('pede a URL de uma rede e devolve a URL', async () => {
    const calls = stub([{ body: { url: 'https://oauth/linkedin', platform: 'linkedin' } }]);
    const client = createSocialClient(CONFIG);

    const result = await client.connectUrl(
      { platform: SocialPlatform.LINKEDIN, externalId: EXTERNAL_ID },
      signal(),
    );

    expect(result).toEqual({ url: 'https://oauth/linkedin' });
    expect(calls[0]?.url).toBe('https://api.postforme.dev/v1/social-accounts/auth-url');
    expect(bodyOf(calls[0])).toMatchObject({ platform: 'linkedin', external_id: EXTERNAL_ID });
  });

  /**
   * O default do provider já é só `posts`. Mandar explícito trava a intenção: ler
   * timeline não é escopo, e permissão que não se usa é permissão pedida ao
   * cliente por nada (spec §2.1).
   */
  it('não pede a permissão de leitura de feed', async () => {
    const calls = stub([{ body: { url: 'https://oauth/x', platform: 'x' } }]);
    const client = createSocialClient(CONFIG);

    await client.connectUrl({ platform: SocialPlatform.X, externalId: EXTERNAL_ID }, signal());

    expect(bodyOf(calls[0]).permissions).toEqual(['posts']);
  });

  // Uma URL vazia levaria o cliente a uma página em branco.
  it('recusa resposta sem url', async () => {
    stub([{ body: { platform: 'linkedin' } }]);
    const client = createSocialClient(CONFIG);

    await expect(
      client.connectUrl({ platform: SocialPlatform.LINKEDIN, externalId: EXTERNAL_ID }, signal()),
    ).rejects.toMatchObject({ kind: 'UNKNOWN' });
  });
});

describe('connectUrl do Bluesky', () => {
  /**
   * A única rede que não é OAuth: o provider pede `handle` e `app_password` em
   * `platform_data.bluesky`, valida contra o Bluesky e cria a conta no servidor.
   */
  it('manda as credenciais em platform_data.bluesky', async () => {
    const calls = stub([{ status: 201, body: { url: 'https://app.postforme.dev/callback/bluesky/account?handle=acme' } }]);
    const client = createSocialClient(CONFIG);

    await client.connectUrl(
      {
        platform: SocialPlatform.BLUESKY,
        externalId: EXTERNAL_ID,
        credentials: { handle: 'acme.bsky.social', appPassword: 'abcd-efgh' },
      },
      signal(),
    );

    expect(bodyOf(calls[0])).toMatchObject({
      platform: 'bluesky',
      platform_data: { bluesky: { handle: 'acme.bsky.social', app_password: 'abcd-efgh' } },
    });
  });

  // Rede de OAuth não recebe `platform_data`: o campo só existe quando há
  // credencial.
  it('não manda platform_data sem credenciais', async () => {
    const calls = stub([{ status: 201, body: { url: 'https://linkedin/oauth' } }]);
    const client = createSocialClient(CONFIG);

    await client.connectUrl({ platform: SocialPlatform.LINKEDIN, externalId: EXTERNAL_ID }, signal());

    expect('platform_data' in bodyOf(calls[0])).toBe(false);
  });

  /**
   * Um Bluesky sem credenciais responde `{"url":""}` — 201, sem erro, verificado
   * contra a API. Sem `min(1)` no schema isso viraria um botão que leva a lugar
   * nenhum.
   */
  it('recusa a URL vazia que o provider devolve sem credenciais', async () => {
    stub([{ status: 201, body: { url: '', platform: 'bluesky' } }]);
    const client = createSocialClient(CONFIG);

    await expect(
      client.connectUrl({ platform: SocialPlatform.BLUESKY, externalId: EXTERNAL_ID }, signal()),
    ).rejects.toMatchObject({ kind: 'UNKNOWN' });
  });
});

describe('autenticação', () => {
  it('usa Bearer', async () => {
    const calls = stub([{ body: { data: [], meta: { total: 0 } } }]);
    const client = createSocialClient(CONFIG);

    await client.listAccounts(EXTERNAL_ID, signal());

    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe('Bearer k');
  });

  it('um header do caller não substitui a credencial da conta', async () => {
    // A garantia é estrutural: `authorization` entra por último no spread. Este
    // teste trava o comportamento para quem reordenar depois.
    const calls = stub([{ body: { url: 'https://oauth/x', platform: 'x' } }]);
    const client = createSocialClient(CONFIG);

    await client.connectUrl({ platform: SocialPlatform.X, externalId: EXTERNAL_ID }, signal());

    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe('Bearer k');
  });
});

describe('classificação da falha', () => {
  const cases: Array<[number, SocialFailureKind]> = [
    [401, 'AUTH'],
    [403, 'AUTH'],
    // Roteamento acontece antes de qualquer criação: o post não existe. Tratá-los
    // como indeterminado mandaria o fundador conferir uma rede que nada recebeu.
    [400, 'VALIDATION'],
    [404, 'VALIDATION'],
    [405, 'VALIDATION'],
    [422, 'VALIDATION'],
    [429, 'RATE_LIMIT'],
    [500, 'PROVIDER'],
    [503, 'PROVIDER'],
    [418, 'UNKNOWN'],
  ];

  for (const [status, kind] of cases) {
    it(`status ${status} é ${kind}`, async () => {
      stub([{ status, body: { message: 'nope' } }]);
      const client = createSocialClient(CONFIG);

      await expect(client.results('post_1', signal())).rejects.toMatchObject({ kind, status });
    });
  }

  it('erro de fetch é NETWORK', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('socket hang up')));
    const client = createSocialClient(CONFIG);

    await expect(client.results('post_1', signal())).rejects.toMatchObject({ kind: 'NETWORK' });
  });

  it('usa a mensagem do provider quando ela vem', async () => {
    stub([{ status: 400, body: { message: 'caption is too long' } }]);
    const client = createSocialClient(CONFIG);

    await expect(client.results('post_1', signal())).rejects.toThrow(/caption is too long/);
  });

  /**
   * O corpo real de um 400 de validação, copiado da resposta da API — `message` é
   * uma **lista**, e o OpenAPI só documenta a string. Aceitar só string fazia o
   * parse inteiro falhar, e o fundador lia o número do status no lugar do motivo.
   */
  it('usa a mensagem do provider quando ela vem em lista', async () => {
    stub([
      {
        status: 400,
        body: {
          message: ['each value in permissions must be one of the following values: posts, feeds'],
          error: 'Bad Request',
          statusCode: 400,
        },
      },
    ]);
    const client = createSocialClient(CONFIG);

    await expect(client.results('post_1', signal())).rejects.toThrow(/must be one of the following values/);
  });

  it('junta as mensagens quando a lista tem mais de uma', async () => {
    stub([{ status: 422, body: { message: ['caption is required', 'social_accounts must not be empty'] } }]);
    const client = createSocialClient(CONFIG);

    await expect(client.results('post_1', signal())).rejects.toThrow(
      /caption is required; social_accounts must not be empty/,
    );
  });

  // Lista vazia não é mensagem: melhor o status do que uma frase em branco.
  it('cai no status quando a lista vem vazia', async () => {
    stub([{ status: 500, body: { message: [] } }]);
    const client = createSocialClient(CONFIG);

    await expect(client.results('post_1', signal())).rejects.toThrow(/status 500/);
  });

  /**
   * A terceira forma de erro deles, copiada da resposta real de
   * `POST /v1/social-posts`: `message` é genérico e o motivo está em `errors`.
   * Lê-se `errors` primeiro porque "Invalid Request" não diz qual campo caiu.
   */
  it('prefere errors a um message genérico', async () => {
    stub([
      {
        status: 400,
        body: { statusCode: 400, message: 'Invalid Request', errors: ['invalid media URL: undefined'] },
      },
    ]);
    const client = createSocialClient(CONFIG);

    await expect(client.results('post_1', signal())).rejects.toThrow(/invalid media URL/);
  });

  it('junta os errors quando há mais de um', async () => {
    stub([{ status: 400, body: { message: 'Invalid Request', errors: ['a inválido', 'b inválido'] } }]);
    const client = createSocialClient(CONFIG);

    await expect(client.results('post_1', signal())).rejects.toThrow(/a inválido; b inválido/);
  });

  // `errors: []` não é motivo: volta a valer o `message`, mesmo genérico.
  it('cai no message quando errors vem vazio', async () => {
    stub([{ status: 400, body: { message: 'Invalid Request', errors: [] } }]);
    const client = createSocialClient(CONFIG);

    await expect(client.results('post_1', signal())).rejects.toThrow(/Invalid Request/);
  });
});

describe('isRetriable e isIndeterminate', () => {
  const kinds: SocialFailureKind[] = ['AUTH', 'VALIDATION', 'RATE_LIMIT', 'PROVIDER', 'NETWORK', 'UNKNOWN'];

  // Se um kind fosse os dois, o processor retentaria o que pode ter publicado —
  // o post duplicado que todo este desenho existe para impedir.
  it('são disjuntos para todo kind', () => {
    for (const kind of kinds) {
      expect(isRetriable(kind) && isIndeterminate(kind)).toBe(false);
    }
  });

  it('retentável é só o que o provider respondeu', () => {
    expect(isRetriable('RATE_LIMIT')).toBe(true);
    expect(isRetriable('PROVIDER')).toBe(true);
    expect(isRetriable('NETWORK')).toBe(false);
    expect(isRetriable('AUTH')).toBe(false);
  });

  it('indeterminado é só o que não se sabe', () => {
    expect(isIndeterminate('NETWORK')).toBe(true);
    expect(isIndeterminate('UNKNOWN')).toBe(true);
    expect(isIndeterminate('VALIDATION')).toBe(false);
  });
});

describe('listAccounts', () => {
  const account = (over: Record<string, unknown> = {}) => ({
    id: 'acc-1',
    platform: 'linkedin',
    username: 'acme',
    profile_photo_url: 'https://img/1',
    status: 'connected',
    external_id: EXTERNAL_ID,
    access_token: 'secret-access',
    refresh_token: 'secret-refresh',
    ...over,
  });

  it('filtra pelo external_id do workspace', async () => {
    const calls = stub([{ body: { data: [account()], meta: { total: 1 } } }]);
    const client = createSocialClient(CONFIG);

    await client.listAccounts(EXTERNAL_ID, signal());

    expect(calls[0]?.url).toContain(`external_id=${encodeURIComponent(EXTERNAL_ID)}`);
  });

  it('mapeia a conta conectada', async () => {
    stub([{ body: { data: [account()], meta: { total: 1 } } }]);
    const client = createSocialClient(CONFIG);

    await expect(client.listAccounts(EXTERNAL_ID, signal())).resolves.toEqual([
      {
        id: 'acc-1',
        platform: SocialPlatform.LINKEDIN,
        username: 'acme',
        pictureUrl: 'https://img/1',
        connected: true,
      },
    ]);
  });

  // `disconnected` é estado explícito do provider, e substitui a flag de
  // reautenticação do fornecedor anterior (spec §2.3).
  it('marca desconectada a conta sem token', async () => {
    stub([{ body: { data: [account({ status: 'disconnected' })], meta: { total: 1 } } }]);
    const client = createSocialClient(CONFIG);

    const accounts = await client.listAccounts(EXTERNAL_ID, signal());

    expect(accounts[0]?.connected).toBe(false);
  });

  /**
   * O provider devolve os tokens do cliente nessa leitura. Eles param aqui: o tipo
   * que sai desta função não os tem, e nenhuma rota nossa pode espalhá-los por
   * acidente (spec §2.3, risco 3).
   */
  it('nunca devolve access_token nem refresh_token', async () => {
    stub([{ body: { data: [account()], meta: { total: 1 } } }]);
    const client = createSocialClient(CONFIG);

    const accounts = await client.listAccounts(EXTERNAL_ID, signal());

    expect(JSON.stringify(accounts)).not.toMatch(/secret-access|secret-refresh|access_token|refresh_token/);
  });

  // Pinterest e Bluesky continuam fora do enum; uma conta delas na listagem não
  // pode derrubar as que funcionam.
  it('ignora rede que a AUREA não modela', async () => {
    stub([
      {
        body: {
          data: [account({ id: 'acc-pin', platform: 'pinterest' }), account()],
          meta: { total: 2 },
        },
      },
    ]);
    const client = createSocialClient(CONFIG);

    const accounts = await client.listAccounts(EXTERNAL_ID, signal());

    expect(accounts.map((item) => item.id)).toEqual(['acc-1']);
  });

  it('lê as contas das redes de mídia', async () => {
    stub([
      {
        body: {
          data: [
            account({ id: 'acc-ig', platform: 'instagram' }),
            account({ id: 'acc-tt', platform: 'tiktok' }),
            account({ id: 'acc-yt', platform: 'youtube' }),
          ],
          meta: { total: 3 },
        },
      },
    ]);
    const client = createSocialClient(CONFIG);

    const accounts = await client.listAccounts(EXTERNAL_ID, signal());

    expect(accounts.map((item) => item.platform)).toEqual(['INSTAGRAM', 'TIKTOK', 'YOUTUBE']);
  });

  it('lista vazia quando não há conta', async () => {
    stub([{ body: { data: [], meta: { total: 0 } } }]);
    const client = createSocialClient(CONFIG);

    await expect(client.listAccounts(EXTERNAL_ID, signal())).resolves.toEqual([]);
  });
});

describe('publish', () => {
  it('manda a legenda e os ids de conta, sem mídia', async () => {
    const calls = stub([{ body: { id: 'post_1', status: 'processing' } }]);
    const client = createSocialClient(CONFIG);

    const result = await client.publish(
      { caption: 'olá', socialAccountIds: ['acc-1', 'acc-2'], externalId: EXTERNAL_ID },
      signal(),
    );

    expect(result).toEqual({ postId: 'post_1' });
    expect(calls[0]?.url).toBe('https://api.postforme.dev/v1/social-posts');
    const body = bodyOf(calls[0]);
    expect(body).toMatchObject({ caption: 'olá', social_accounts: ['acc-1', 'acc-2'] });
    // Texto puro é ausência de mídia, e não uma lista vazia: o provider trata
    // `media: []` e `media` ausente de formas que não precisamos descobrir.
    expect('media' in body).toBe(false);
    // Agendar está fora de escopo: a AUREA tem relógio próprio (spec §8).
    expect('scheduled_at' in body).toBe(false);
  });

  /**
   * A forma verificada contra a API: `media` é lista de **objetos** com `url`. Uma
   * lista de strings responde `{"errors":["invalid media URL: undefined"]}`.
   */
  it('manda cada imagem como objeto com url', async () => {
    const calls = stub([{ body: { id: 'post_2', status: 'processing' } }]);
    const client = createSocialClient(CONFIG);

    await client.publish(
      {
        caption: 'com imagem',
        socialAccountIds: ['acc-1'],
        externalId: EXTERNAL_ID,
        mediaUrls: ['https://cdn.test.aurea/media/ws/a.png', 'https://cdn.test.aurea/media/ws/b.jpg'],
      },
      signal(),
    );

    expect(bodyOf(calls[0]).media).toEqual([
      { url: 'https://cdn.test.aurea/media/ws/a.png' },
      { url: 'https://cdn.test.aurea/media/ws/b.jpg' },
    ]);
  });

  // Uma ação sem imagem chega aqui com `[]` ou `undefined`, e nos dois casos o
  // campo tem de **desaparecer** do corpo.
  it('omite media quando a lista está vazia', async () => {
    const calls = stub([{ body: { id: 'post_3' } }, { body: { id: 'post_4' } }]);
    const client = createSocialClient(CONFIG);

    await client.publish({ caption: 'a', socialAccountIds: ['acc-1'], externalId: EXTERNAL_ID, mediaUrls: [] }, signal());
    await client.publish(
      { caption: 'b', socialAccountIds: ['acc-1'], externalId: EXTERNAL_ID, mediaUrls: undefined },
      signal(),
    );

    expect('media' in bodyOf(calls[0])).toBe(false);
    expect('media' in bodyOf(calls[1])).toBe(false);
  });

  /**
   * O título do YouTube só existe dentro de `platform_configurations.youtube` — o
   * post do provider não tem `title`. E `privacy_status` vai explícito: o default
   * deles já é `public`, e deixar a decisão mais irreversível do fluxo depender de
   * um campo omitido é frágil de um jeito que não se percebe até mudar.
   */
  it('manda título e privacidade pública para o YouTube', async () => {
    const calls = stub([{ body: { id: 'post_yt' } }]);
    const client = createSocialClient(CONFIG);

    await client.publish(
      {
        caption: 'legenda',
        socialAccountIds: ['acc-yt'],
        externalId: EXTERNAL_ID,
        mediaUrls: ['https://cdn.test.aurea/media/ws/v.mp4'],
        platforms: [SocialPlatform.YOUTUBE],
        title: 'Como cortamos 30% do custo',
      },
      signal(),
    );

    expect(bodyOf(calls[0]).platform_configurations).toEqual({
      youtube: { title: 'Como cortamos 30% do custo', privacy_status: 'public', localizations: {} },
    });
  });

  // `is_draft: false` é publicação direta. Rascunho quebraria o laço: a AUREA não
  // saberia se virou post, e não haveria URL nem desfecho.
  it('publica direto no TikTok', async () => {
    const calls = stub([{ body: { id: 'post_tt' } }]);
    const client = createSocialClient(CONFIG);

    await client.publish(
      {
        caption: 'legenda',
        socialAccountIds: ['acc-tt'],
        externalId: EXTERNAL_ID,
        mediaUrls: ['https://cdn.test.aurea/media/ws/v.mp4'],
        platforms: [SocialPlatform.TIKTOK],
      },
      signal(),
    );

    expect(bodyOf(calls[0]).platform_configurations).toEqual({ tiktok: { is_draft: false } });
  });

  // O Meta não publica vídeo na timeline: vídeo é Reels, imagem é timeline.
  it('escolhe o placement do Instagram pelo tipo do arquivo', async () => {
    const calls = stub([{ body: { id: 'p1' } }, { body: { id: 'p2' } }]);
    const client = createSocialClient(CONFIG);
    const common = {
      caption: 'c',
      socialAccountIds: ['acc-ig'],
      externalId: EXTERNAL_ID,
      platforms: [SocialPlatform.INSTAGRAM],
    };

    await client.publish({ ...common, mediaUrls: ['https://cdn.test.aurea/media/ws/v.mp4'] }, signal());
    await client.publish({ ...common, mediaUrls: ['https://cdn.test.aurea/media/ws/a.png'] }, signal());

    expect(bodyOf(calls[0]).platform_configurations).toEqual({ instagram: { placement: 'reels' } });
    expect(bodyOf(calls[1]).platform_configurations).toEqual({ instagram: { placement: 'timeline' } });
  });

  /**
   * Só as redes deste post entram. Mandar configuração de uma rede que não está no
   * `social_accounts` é ruído que o provider aceita calado — não há validação
   * nesse objeto, verificado contra a API.
   */
  it('não manda configuração de rede que não está no post', async () => {
    const calls = stub([{ body: { id: 'p1' } }, { body: { id: 'p2' } }]);
    const client = createSocialClient(CONFIG);

    await client.publish(
      { caption: 'c', socialAccountIds: ['acc-li'], externalId: EXTERNAL_ID, platforms: [SocialPlatform.LINKEDIN] },
      signal(),
    );
    // Sem `platforms` — o caminho de quem ainda não passa a informação.
    await client.publish({ caption: 'c', socialAccountIds: ['acc-li'], externalId: EXTERNAL_ID }, signal());

    expect('platform_configurations' in bodyOf(calls[0])).toBe(false);
    expect('platform_configurations' in bodyOf(calls[1])).toBe(false);
  });

  // Sem id não há como ler o desfecho: aceitar isso perderia o post de vista.
  it('recusa resposta sem id', async () => {
    stub([{ body: { status: 'processing' } }]);
    const client = createSocialClient(CONFIG);

    await expect(
      client.publish({ caption: 'oi', socialAccountIds: ['acc-1'], externalId: EXTERNAL_ID }, signal()),
    ).rejects.toMatchObject({ kind: 'UNKNOWN' });
  });
});

describe('results', () => {
  it('mapeia o desfecho por conta, com id e URL da fonte', async () => {
    const calls = stub([
      {
        body: {
          data: [
            {
              id: 'res-1',
              social_account_id: 'acc-1',
              post_id: 'post_1',
              success: true,
              error: null,
              details: null,
              platform_data: { id: 'urn:li:share:1', url: 'https://li/1' },
            },
          ],
          meta: { total: 1 },
        },
      },
    ]);
    const client = createSocialClient(CONFIG);

    const results = await client.results('post_1', signal());

    expect(calls[0]?.url).toContain('post_id=post_1');
    expect(results).toEqual([
      {
        socialAccountId: 'acc-1',
        success: true,
        message: null,
        externalId: 'urn:li:share:1',
        postUrl: 'https://li/1',
      },
    ]);
  });

  /**
   * `error` e `details` são objetos no contrato deles. Sem cuidado, a tela
   * mostraria "[object Object]" ao fundador — que é pior que não mostrar nada.
   */
  it('extrai mensagem legível de um error objeto', async () => {
    stub([
      {
        body: {
          data: [
            {
              social_account_id: 'acc-1',
              success: false,
              error: { message: 'Duplicate content' },
              details: null,
              platform_data: null,
            },
          ],
          meta: { total: 1 },
        },
      },
    ]);
    const client = createSocialClient(CONFIG);

    const results = await client.results('post_1', signal());

    expect(results[0]).toMatchObject({ success: false, message: 'Duplicate content' });
  });

  it('cai numa frase nossa quando o erro não tem nada legível', async () => {
    stub([
      {
        body: {
          data: [{ social_account_id: 'acc-1', success: false, error: { code: 42 }, platform_data: null }],
          meta: { total: 1 },
        },
      },
    ]);
    const client = createSocialClient(CONFIG);

    const results = await client.results('post_1', signal());

    expect(results[0]?.message).toBeTruthy();
    expect(results[0]?.message).not.toContain('object');
  });

  it('aceita error como string', async () => {
    stub([
      {
        body: {
          data: [{ social_account_id: 'acc-1', success: false, error: 'rate limited', platform_data: null }],
          meta: { total: 1 },
        },
      },
    ]);
    const client = createSocialClient(CONFIG);

    await expect(client.results('post_1', signal())).resolves.toMatchObject([{ message: 'rate limited' }]);
  });

  it('sem platform_data, id e URL são nulos', async () => {
    stub([
      {
        body: {
          data: [{ social_account_id: 'acc-1', success: true, error: null, platform_data: null }],
          meta: { total: 1 },
        },
      },
    ]);
    const client = createSocialClient(CONFIG);

    await expect(client.results('post_1', signal())).resolves.toMatchObject([
      { externalId: null, postUrl: null },
    ]);
  });
});

describe('disconnect', () => {
  /**
   * `disconnect` apaga os tokens e preserva o registro; `DELETE` destrói o
   * histórico. Nossos `ExternalReference` apontam para o alvo, e o alvo guarda o id
   * da conta — apagar a conta lá deixaria a proveniência apontando para o vazio
   * (spec §2.3).
   */
  it('desconecta sem apagar o histórico', async () => {
    const calls = stub([{ body: {} }]);
    const client = createSocialClient(CONFIG);

    await client.disconnect('acc-1', signal());

    expect(calls[0]?.url).toBe('https://api.postforme.dev/v1/social-accounts/acc-1/disconnect');
    expect(calls[0]?.init.method).toBe('POST');
  });

  it('nunca usa DELETE', async () => {
    const calls = stub([{ body: {} }]);
    const client = createSocialClient(CONFIG);

    await client.disconnect('acc-1', signal());

    expect(calls.every((call) => call.init.method !== 'DELETE')).toBe(true);
  });
});

describe('SocialProviderError', () => {
  it('carrega kind e status', () => {
    const error = new SocialProviderError('AUTH', 'Unauthorized', 401);

    expect(error.kind).toBe('AUTH');
    expect(error.status).toBe(401);
    expect(error).toBeInstanceOf(Error);
  });
});

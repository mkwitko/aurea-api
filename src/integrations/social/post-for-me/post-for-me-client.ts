import type { SocialPlatform } from '@prisma/client';
import { z } from 'zod';
import { PLATFORM_SLUG, platformFromSlug } from './platforms.js';

export type PostForMeConfig = { apiKey: string; baseUrl: string };

/**
 * O que sabemos sobre uma chamada que deu errado.
 *
 * A pergunta que o kind responde não é "o erro é transitório?", é "o que sabemos
 * sobre a chamada?" — porque a decisão que depende dele é retentar, e retentar o
 * que talvez tenha publicado cria um post público duplicado.
 */
export type SocialFailureKind = 'AUTH' | 'VALIDATION' | 'RATE_LIMIT' | 'PROVIDER' | 'NETWORK' | 'UNKNOWN';

export class SocialProviderError extends Error {
  constructor(
    readonly kind: SocialFailureKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SocialProviderError';
  }
}

function classify(status: number): SocialFailureKind {
  if (status === 401 || status === 403) return 'AUTH';
  // 404 e 405 vêm de roteamento — baseUrl errada, proxy na frente — e roteamento
  // acontece antes de qualquer criação: o post não existe. Classificá-los como
  // indeterminado deixaria toda publicação de uma instância mal configurada em
  // DELIVERY_UNKNOWN, mandando o fundador conferir redes que nada receberam.
  if (status === 400 || status === 404 || status === 405 || status === 422) return 'VALIDATION';
  if (status === 429) return 'RATE_LIMIT';
  if (status >= 500) return 'PROVIDER';
  return 'UNKNOWN';
}

/** Retentável = o provider respondeu, então não criou nada. */
export function isRetriable(kind: SocialFailureKind): boolean {
  return kind === 'RATE_LIMIT' || kind === 'PROVIDER';
}

/**
 * Indeterminado = não sabemos se criou. Nunca retenta: um segundo envio pode
 * duplicar um post público, que a AUREA não consegue apagar.
 *
 * Disjunto de `isRetriable` por construção, e há teste para todo kind.
 */
export function isIndeterminate(kind: SocialFailureKind): boolean {
  return kind === 'NETWORK' || kind === 'UNKNOWN';
}

/**
 * O identificador do workspace nas contas do provider.
 *
 * Opaco e derivado do id, não do nome: o nome do workspace muda, e não é nosso
 * para vazar ao fornecedor (spec §4).
 */
export function socialExternalId(workspaceId: string): string {
  return `ws-${workspaceId}`;
}

/**
 * Uma conta conectada, como a AUREA a conhece.
 *
 * **Sem token.** O provider devolve `access_token` e `refresh_token` na leitura de
 * contas; eles param no conector, e este tipo é a fronteira que garante isso
 * (spec §2.3).
 */
export type SocialAccount = {
  id: string;
  platform: SocialPlatform;
  username: string | null;
  pictureUrl: string | null;
  /** `false` quando o provider marcou a conta como desconectada. */
  connected: boolean;
};

export type PlatformOutcome = {
  socialAccountId: string;
  success: boolean;
  message: string | null;
  externalId: string | null;
  postUrl: string | null;
};

export type PublishInput = {
  caption: string;
  socialAccountIds: string[];
  externalId: string;
  mediaUrls?: string[];
  /**
   * As redes deste post, para montar `platform_configurations`.
   *
   * A configuração do provider é **por rede**, não por conta, e a AUREA precisa
   * mandá-la: sem ela o YouTube não tem título, e o vídeo do Instagram iria para o
   * lugar errado.
   */
  platforms?: SocialPlatform[];
  /** O título do vídeo. Só o YouTube o exige, e é lá que ele entra. */
  title?: string;
};

export type SocialClient = {
  connectUrl(
    input: {
      platform: SocialPlatform;
      externalId: string;
      /**
       * As credenciais do Bluesky, a única rede que não usa OAuth.
       *
       * Passam por aqui e não param em lugar nenhum: não são gravadas, não entram
       * em log, e não voltam em resposta. O provider valida contra o Bluesky e
       * guarda o que precisar do lado dele.
       */
      credentials?: { handle: string; appPassword: string };
    },
    signal: AbortSignal,
  ): Promise<{ url: string }>;
  listAccounts(externalId: string, signal: AbortSignal): Promise<SocialAccount[]>;
  publish(input: PublishInput, signal: AbortSignal): Promise<{ postId: string }>;
  results(postId: string, signal: AbortSignal): Promise<PlatformOutcome[]>;
  disconnect(accountId: string, signal: AbortSignal): Promise<void>;
};

// Nenhum `.default()` nos schemas de resposta: um default esconderia campo
// ausente do provider e viraria "publicado" silencioso. O que falta é `null`
// explícito, ou falha de parse.
const connectUrlSchema = z.object({ url: z.string().min(1) });

const createdPostSchema = z.object({ id: z.string().min(1) });

const accountsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      platform: z.string(),
      username: z.string().nullish(),
      profile_photo_url: z.string().nullish(),
      status: z.string().nullish(),
    }),
  ),
});

const resultsSchema = z.object({
  data: z.array(
    z.object({
      social_account_id: z.string(),
      success: z.boolean(),
      error: z.unknown().nullish(),
      details: z.unknown().nullish(),
      platform_data: z.object({ id: z.string().nullish(), url: z.string().nullish() }).nullish(),
    }),
  ),
});

/**
 * O corpo de uma falha do provider, nas três formas que ele realmente manda.
 *
 * Todas verificadas contra a API, não no OpenAPI, que documenta só a primeira:
 *
 * 1. `{"message":"...", "error":"Bad Request"}`
 * 2. `{"message":["each value in permissions must be one of ..."],"error":"Bad Request"}`
 * 3. `{"statusCode":400,"message":"Invalid Request","errors":["invalid media URL: undefined"]}`
 *
 * Na terceira, `message` é genérico e o motivo está em `errors` — por isso ela é
 * lida primeiro. Ignorá-la fazia o fundador ler "Invalid Request", que não diz
 * qual campo está errado.
 */
const errorMessageSchema = z.object({
  message: z.union([z.string(), z.array(z.string())]).nullish(),
  errors: z.array(z.string()).nullish(),
  error: z.unknown().nullish(),
});

/** A lista de validação virada numa frase; `null` quando não há texto nenhum. */
function messageText(value: string | string[] | null | undefined): string | null {
  const parts = (typeof value === 'string' ? [value] : (value ?? [])).filter((part) => part.trim() !== '');
  return parts.length > 0 ? parts.join('; ') : null;
}

/**
 * A mensagem legível de um `error`/`details` que o provider manda como **objeto**.
 *
 * Sem isto, a tela mostraria "[object Object]" ao fundador — que é pior que não
 * mostrar nada, porque parece defeito nosso e não explica o dele.
 */
export function providerReason(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['message', 'error', 'detail', 'description']) {
      const inner = record[key];
      if (typeof inner === 'string' && inner.trim() !== '') return inner;
    }
  }
  return null;
}

function trimBase(raw: string): string {
  return raw.replace(/\/+$/, '');
}

/** Vídeo pela extensão que o nosso upload escreveu na chave do objeto. */
function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|webm)(\?|$)/i.test(url);
}

/**
 * `platform_configurations`: o que cada rede precisa além da legenda.
 *
 * Só as redes deste post entram. Mandar configuração de uma rede que não está no
 * post é ruído que o provider aceita calado — eles não validam este objeto,
 * verificado contra a API: `{"nao_existe":{}}` foi aceito com 201.
 *
 * Cada campo aqui é uma decisão de produto, não um default do fornecedor:
 *
 * - **YouTube.** `title` é obrigatório na rede e não existe no post do provider,
 *   só aqui. `privacy_status: 'public'` é explícito de propósito: o default deles
 *   já é `public`, e depender de um default para tornar um vídeo público seria
 *   confiar a decisão mais irreversível do fluxo a um valor omitido. O diálogo de
 *   confirmação diz "público" antes do clique. `localizations` aparece como
 *   obrigatório no OpenAPI deles — provável defeito do spec, já que aceitam a
 *   configuração sem ele; vai como `{}` para não depender de qual das duas leituras
 *   está certa.
 * - **TikTok.** `is_draft: false` — publicação direta. Se a app deles não passou
 *   pelo audit de Direct Post da TikTok, isto falha com mensagem, e falha limpa é
 *   melhor que rascunho que a AUREA não sabe se virou post.
 * - **Instagram.** `reels` para vídeo, `timeline` para imagem: o Meta não publica
 *   vídeo na timeline. Sem stories, que expira em 24h e não é post.
 */
function platformConfigurations(input: PublishInput): Record<string, unknown> {
  const platforms = input.platforms ?? [];
  if (platforms.length === 0) return {};

  const hasVideo = (input.mediaUrls ?? []).some(isVideoUrl);
  const config: Record<string, unknown> = {};

  for (const platform of platforms) {
    if (platform === 'YOUTUBE') {
      config.youtube = {
        ...(input.title ? { title: input.title } : {}),
        privacy_status: 'public',
        localizations: {},
      };
    }
    if (platform === 'TIKTOK') config.tiktok = { is_draft: false };
    if (platform === 'INSTAGRAM') config.instagram = { placement: hasVideo ? 'reels' : 'timeline' };
  }

  return Object.keys(config).length > 0 ? { platform_configurations: config } : {};
}

export function createSocialClient(config: PostForMeConfig): SocialClient {
  const base = `${trimBase(config.baseUrl)}/v1`;

  /**
   * Toda chamada passa por aqui, e toda falha sai como `SocialProviderError` com
   * kind. Um erro cru de `fetch` escapando daqui viraria 500 sem classificação — e
   * é o kind que decide retentar.
   */
  async function request(path: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          // `authorization` por último: um caller que passasse esse header por
          // engano não pode substituir a credencial da conta.
          authorization: `Bearer ${config.apiKey}`,
        },
        signal,
      });
    } catch (error) {
      // Rede morta, abort, DNS: não houve resposta, então não se sabe nada.
      throw new SocialProviderError('NETWORK', error instanceof Error ? error.message : 'the request failed');
    }

    if (!response.ok) {
      const raw = await response.json().catch(() => null);
      const parsed = errorMessageSchema.safeParse(raw);
      const detail = parsed.success
        ? (messageText(parsed.data.errors) ??
          messageText(parsed.data.message) ??
          providerReason(parsed.data.error))
        : null;
      throw new SocialProviderError(
        classify(response.status),
        detail ?? `the social provider failed with status ${response.status}`,
        response.status,
      );
    }

    return response.json().catch(() => null);
  }

  const json = (payload: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return {
    async connectUrl(input, signal) {
      const body = await request(
        '/social-accounts/auth-url',
        json({
          platform: PLATFORM_SLUG[input.platform],
          external_id: input.externalId,
          // O provider aceita `posts` ou `feeds`, e recusa qualquer outro valor.
          //
          // Não confunda com escopo OAuth: verificado contra a API, o escopo pedido
          // é o mesmo com `posts`, com `feeds` ou sem o campo — o X pede
          // `tweet.read users.read media.write` de todo jeito, e o Facebook pede
          // `pages_read_engagement` e `business_management`. Quem decide o que o
          // cliente autoriza é o app deles, não este campo.
          permissions: ['posts'],
          // Só o Bluesky manda `platform_data`, e só quando as credenciais vêm.
          ...(input.credentials
            ? {
                platform_data: {
                  bluesky: { handle: input.credentials.handle, app_password: input.credentials.appPassword },
                },
              }
            : {}),
        }),
        signal,
      );

      const parsed = connectUrlSchema.safeParse(body);
      // Sem URL não há conexão, e devolver uma vazia levaria o cliente a uma
      // página em branco. É exatamente o que o provider responde num Bluesky sem
      // credenciais: `{"url":""}`, sem erro — `min(1)` no schema é o que pega isso.
      if (!parsed.success) throw new SocialProviderError('UNKNOWN', 'the provider returned no connect url');
      return { url: parsed.data.url };
    },

    async listAccounts(externalId, signal) {
      const body = await request(
        `/social-accounts?external_id=${encodeURIComponent(externalId)}&limit=50`,
        { method: 'GET' },
        signal,
      );

      const parsed = accountsSchema.safeParse(body);
      if (!parsed.success) throw new SocialProviderError('UNKNOWN', 'the provider returned an unreadable account list');

      const accounts: SocialAccount[] = [];
      for (const row of parsed.data.data) {
        const platform = platformFromSlug(row.platform);
        // Rede que a AUREA não modela — Instagram e TikTok exigem mídia, Bluesky
        // pede senha de app. Ignorada em vez de derrubar as que interessam.
        if (!platform) continue;
        accounts.push({
          id: row.id,
          platform,
          username: row.username ?? null,
          pictureUrl: row.profile_photo_url ?? null,
          // Só `disconnected` é desconectado: um status novo que eles inventem
          // conta como conectado, e a publicação decide pelo resultado real.
          connected: row.status !== 'disconnected',
        });
      }
      return accounts;
    },

    async publish(input, signal) {
      const media = input.mediaUrls ?? [];
      const body = await request(
        '/social-posts',
        json({
          caption: input.caption,
          social_accounts: input.socialAccountIds,
          external_id: input.externalId,
          // Texto puro é a **ausência** do campo, não uma lista vazia: verificado
          // contra a API, `media` é lista de objetos com `url`, e um objeto sem
          // `url` responde `{"errors":["invalid media URL: undefined"]}`.
          //
          // A URL tem de ser pública quando eles a buscarem — é o bucket do R2
          // que serve, não nós.
          ...(media.length > 0 ? { media: media.map((url) => ({ url })) } : {}),
          ...platformConfigurations(input),
          // Sem `scheduled_at`: agendar está fora de escopo, e a AUREA tem
          // relógio próprio.
        }),
        signal,
      );

      const parsed = createdPostSchema.safeParse(body);
      // Sem `id` não há como ler o desfecho nem retentar o que falhou. Aceitar
      // isso silenciosamente perderia o post de vista.
      if (!parsed.success) throw new SocialProviderError('UNKNOWN', 'the provider returned no post id');
      return { postId: parsed.data.id };
    },

    async results(postId, signal) {
      const body = await request(
        `/social-post-results?post_id=${encodeURIComponent(postId)}&limit=50`,
        { method: 'GET' },
        signal,
      );

      const parsed = resultsSchema.safeParse(body);
      if (!parsed.success) throw new SocialProviderError('UNKNOWN', 'the provider returned an unreadable result list');

      return parsed.data.data.map((row) => ({
        socialAccountId: row.social_account_id,
        success: row.success,
        message: row.success
          ? null
          : (providerReason(row.error) ??
            providerReason(row.details) ??
            'the network refused this post, without saying why'),
        externalId: row.platform_data?.id ?? null,
        postUrl: row.platform_data?.url ?? null,
      }));
    },

    async disconnect(accountId, signal) {
      // `disconnect`, nunca `DELETE`: apagar destruiria o histórico da conta, e a
      // proveniência dos nossos alvos aponta para ela (spec §2.3).
      await request(`/social-accounts/${encodeURIComponent(accountId)}/disconnect`, { method: 'POST' }, signal);
    },
  };
}

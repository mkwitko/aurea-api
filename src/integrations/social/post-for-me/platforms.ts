import type { SocialPlatform } from '@prisma/client';

/**
 * O slug de cada plataforma no provider, verificado no OpenAPI (spec §2.2).
 *
 * `Record` completo de propósito: uma plataforma nova no enum do Prisma sem slug
 * aqui não compila, em vez de virar `undefined` numa chamada e conectar nada
 * silenciosamente.
 */
export const PLATFORM_SLUG: Record<SocialPlatform, string> = {
  LINKEDIN: 'linkedin',
  X: 'x',
  FACEBOOK: 'facebook',
  THREADS: 'threads',
  INSTAGRAM: 'instagram',
  TIKTOK: 'tiktok',
  YOUTUBE: 'youtube',
  BLUESKY: 'bluesky',
};

/**
 * As redes que **não** conectam por OAuth.
 *
 * Bluesky é a única: o provider pede `handle` e `app_password` em
 * `platform_data.bluesky` e cria a conta no servidor. A `url` que ele devolve é
 * uma página de aterrissagem no domínio dele, não um consentimento — e sem
 * `platform_data` ele devolve `{"url":""}`, sem erro, verificado contra a API.
 */
export const PLATFORMS_WITH_CREDENTIALS: SocialPlatform[] = ['BLUESKY'];

const BY_SLUG = new Map<string, SocialPlatform>(
  Object.entries(PLATFORM_SLUG).map(([platform, slug]) => [slug, platform as SocialPlatform]),
);

/**
 * `null` para slug desconhecido, e nunca um throw.
 *
 * O provider suporta nove redes e a AUREA modela sete. Fora ficam **Pinterest**,
 * cuja credencial não está habilitada na conta do provider — `auth-url` responde
 * `404 Social provider app credentials not found for pinterest` — e **Bluesky**,
 * que pede senha de app em vez de OAuth. Uma conta dessas na listagem é ignorada;
 * derrubar a lista por causa dela esconderia as contas que funcionam.
 */
export function platformFromSlug(slug: string): SocialPlatform | null {
  return BY_SLUG.get(slug.toLowerCase()) ?? null;
}

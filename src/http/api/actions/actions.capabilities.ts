import { SocialPlatform } from '@prisma/client';
import { BadRequestError } from '../../../lib/errors.js';

/** O que um arquivo é, deduzido da extensão que **nós** escrevemos na chave. */
export type MediaKind = 'IMAGE' | 'VIDEO';

/**
 * A extensão manda, e não um campo declarado ao lado da URL.
 *
 * A extensão não vem do cliente: `POST /upload/presigned` a deriva do
 * `content-type` contra um allowlist e a escreve na chave do objeto. Um segundo
 * campo `type` viajando junto poderia discordar da realidade, e aí haveria duas
 * verdades sobre o mesmo arquivo.
 */
const KIND_BY_EXTENSION: Record<string, MediaKind> = {
  '.png': 'IMAGE',
  '.jpg': 'IMAGE',
  '.webp': 'IMAGE',
  '.mp4': 'VIDEO',
  '.mov': 'VIDEO',
  '.webm': 'VIDEO',
};

/** `null` para extensão que não conhecemos — quem decide o que fazer é o caller. */
export function mediaKind(url: string): MediaKind | null {
  const path = url.split('?')[0] ?? '';
  const dot = path.lastIndexOf('.');
  return dot === -1 ? null : (KIND_BY_EXTENSION[path.slice(dot).toLowerCase()] ?? null);
}

/**
 * O que cada rede aceita, e o que ela exige.
 *
 * `Record` completo: uma rede nova no enum do Prisma sem regra aqui não compila.
 * Sem isso, ela cairia num default permissivo e o post falharia na rede, depois de
 * um humano ter aprovado.
 *
 * `requiresMedia` é a diferença que trouxe estas três redes: no Instagram, no
 * TikTok e no YouTube um post sem arquivo não existe. `accepts` é o que a rede
 * publica; `maxMedia` o quanto dela.
 */
type Capability = {
  requiresMedia: boolean;
  accepts: readonly MediaKind[];
  maxMedia: number;
  /** YouTube: o vídeo tem título, e ele não tem de onde sair senão daqui. */
  requiresTitle?: boolean;
};

export const PLATFORM_CAPABILITY: Record<SocialPlatform, Capability> = {
  LINKEDIN: { requiresMedia: false, accepts: ['IMAGE', 'VIDEO'], maxMedia: 4 },
  X: { requiresMedia: false, accepts: ['IMAGE', 'VIDEO'], maxMedia: 4 },
  FACEBOOK: { requiresMedia: false, accepts: ['IMAGE', 'VIDEO'], maxMedia: 4 },
  THREADS: { requiresMedia: false, accepts: ['IMAGE', 'VIDEO'], maxMedia: 4 },
  INSTAGRAM: { requiresMedia: true, accepts: ['IMAGE', 'VIDEO'], maxMedia: 4 },
  TIKTOK: { requiresMedia: true, accepts: ['IMAGE', 'VIDEO'], maxMedia: 4 },
  // Um vídeo, e só um: o YouTube publica um arquivo por vídeo, e imagem ali não é
  // post nenhum.
  YOUTUBE: { requiresMedia: true, accepts: ['VIDEO'], maxMedia: 1, requiresTitle: true },
  // Bluesky publica texto puro como o LinkedIn. O que a distingue é o jeito de
  // conectar, não o de publicar.
  BLUESKY: { requiresMedia: false, accepts: ['IMAGE', 'VIDEO'], maxMedia: 4 },
};

/** As redes que só existem com arquivo, para a tela poder dizer isso antes. */
export const MEDIA_ONLY_PLATFORMS = (Object.keys(PLATFORM_CAPABILITY) as SocialPlatform[]).filter(
  (platform) => PLATFORM_CAPABILITY[platform].requiresMedia,
);

/**
 * Recusa na criação a combinação que a rede não publica.
 *
 * O princípio é o mesmo do botão de retry que foi tirado da tela: não prometer o
 * que a API nega. Descobrir no worker que o YouTube não aceita imagem significa um
 * post aprovado por um humano que falha sozinho depois — e, num post para várias
 * redes, as outras já saíram.
 *
 * Vale para o post inteiro, e não por rede, porque a mídia é uma só: o provider
 * manda o mesmo `media` para todas as contas do post.
 */
export function assertPlatformsAcceptPayload(
  platforms: SocialPlatform[],
  payload: { media?: string[]; title?: string },
): void {
  const media = payload.media ?? [];

  for (const url of media) {
    if (!mediaKind(url)) throw new BadRequestError('This file type cannot be published', { url });
  }

  const kinds = new Set(media.map((url) => mediaKind(url) as MediaKind));

  // Imagem e vídeo no mesmo post: nenhuma rede publica os dois juntos, e escolher
  // um por conta nossa publicaria menos do que o fundador escolheu.
  if (kinds.size > 1) throw new BadRequestError('A post carries images or a video, never both');

  for (const platform of platforms) {
    const rule = PLATFORM_CAPABILITY[platform];

    if (rule.requiresMedia && media.length === 0) {
      throw new BadRequestError('This network needs an image or a video', { platform });
    }
    for (const kind of kinds) {
      if (!rule.accepts.includes(kind)) {
        throw new BadRequestError('This network does not publish this kind of file', { platform, kind });
      }
    }
    if (media.length > rule.maxMedia) {
      throw new BadRequestError('This network accepts fewer files than that', {
        platform,
        maxMedia: rule.maxMedia,
      });
    }
    if (rule.requiresTitle && !payload.title?.trim()) {
      throw new BadRequestError('This network needs a title', { platform });
    }
  }
}

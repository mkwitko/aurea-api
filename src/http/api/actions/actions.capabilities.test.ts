import { SocialPlatform } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../lib/errors.js';
import { listCapabilitiesRoute } from './list-capabilities/list-capabilities.controller.js';
import {
  assertPlatformsAcceptPayload,
  mediaKind,
  MEDIA_ONLY_PLATFORMS,
  PLATFORM_CAPABILITY,
} from './actions.capabilities.js';

const IMAGE = 'https://cdn.test.aurea/media/ws-1/a.png';
const IMAGE2 = 'https://cdn.test.aurea/media/ws-1/b.jpg';
const VIDEO = 'https://cdn.test.aurea/media/ws-1/reel.mp4';

/** O código do erro, ou null quando passou. */
function refused(platforms: SocialPlatform[], payload: { media?: string[]; title?: string }) {
  try {
    assertPlatformsAcceptPayload(platforms, payload);
    return null;
  } catch (error) {
    return error instanceof AppError ? error.statusCode : 'not an AppError';
  }
}

describe('mediaKind', () => {
  it('lê a extensão que o nosso upload escreveu', () => {
    expect(mediaKind(IMAGE)).toBe('IMAGE');
    expect(mediaKind(IMAGE2)).toBe('IMAGE');
    expect(mediaKind('https://cdn.test.aurea/media/ws-1/c.webp')).toBe('IMAGE');
    expect(mediaKind(VIDEO)).toBe('VIDEO');
    expect(mediaKind('https://cdn.test.aurea/media/ws-1/v.mov')).toBe('VIDEO');
    expect(mediaKind('https://cdn.test.aurea/media/ws-1/v.webm')).toBe('VIDEO');
  });

  // Extensão desconhecida é `null`, e nunca um palpite: quem decide é o caller.
  it('devolve null para extensão que não conhece, e para URL sem extensão', () => {
    expect(mediaKind('https://cdn.test.aurea/media/ws-1/x.gif')).toBeNull();
    expect(mediaKind('https://cdn.test.aurea/media/ws-1/x.svg')).toBeNull();
    expect(mediaKind('https://cdn.test.aurea/media/ws-1/semponto')).toBeNull();
  });

  it('não se importa com caixa nem com query string', () => {
    expect(mediaKind('https://cdn.test.aurea/media/ws-1/A.PNG')).toBe('IMAGE');
    expect(mediaKind('https://cdn.test.aurea/media/ws-1/a.mp4?v=2')).toBe('VIDEO');
  });
});

describe('PLATFORM_CAPABILITY', () => {
  // `Record` completo: uma rede nova no enum sem regra cairia num default
  // permissivo, e o post falharia na rede depois de um humano aprovar.
  it('cobre toda rede do enum', () => {
    for (const platform of Object.values(SocialPlatform)) {
      expect(PLATFORM_CAPABILITY[platform], platform).toBeDefined();
    }
  });

  it('nomeia as três redes que só existem com arquivo', () => {
    expect([...MEDIA_ONLY_PLATFORMS].sort()).toEqual(['INSTAGRAM', 'TIKTOK', 'YOUTUBE']);
  });
});

describe('GET /actions/capabilities', () => {
  /**
   * A rota existe para a tela não copiar esta tabela. O que se afirma é que ela
   * devolve a **mesma** tabela que a criação usa para recusar — se divergirem, a
   * tela volta a prometer o que a API nega.
   */
  it('devolve a mesma tabela que a validação usa, para toda rede', async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(listCapabilitiesRoute);

    const res = await app.inject({ method: 'GET', url: '/actions/capabilities' });

    expect(res.statusCode).toBe(200);
    const { capabilities } = res.json() as {
      capabilities: Array<{ platform: SocialPlatform; requiresMedia: boolean; accepts: string[]; maxMedia: number; requiresTitle: boolean }>;
    };
    expect(capabilities).toHaveLength(Object.values(SocialPlatform).length);
    for (const row of capabilities) {
      const rule = PLATFORM_CAPABILITY[row.platform];
      expect(row.requiresMedia, row.platform).toBe(rule.requiresMedia);
      expect(row.accepts, row.platform).toEqual([...rule.accepts]);
      expect(row.maxMedia, row.platform).toBe(rule.maxMedia);
      expect(row.requiresTitle, row.platform).toBe(rule.requiresTitle ?? false);
    }
  });
});

describe('assertPlatformsAcceptPayload', () => {
  it('deixa passar texto puro nas redes que aceitam texto', () => {
    expect(refused(['LINKEDIN', 'X', 'FACEBOOK', 'THREADS'], {})).toBeNull();
  });

  /**
   * A regra que trouxe estas redes: no Instagram, no TikTok e no YouTube um post
   * sem arquivo não existe. Recusar aqui é recusar antes da aprovação, e não no
   * worker — quando as outras redes do mesmo post já publicaram.
   */
  it('recusa texto puro nas redes que exigem mídia', () => {
    for (const platform of MEDIA_ONLY_PLATFORMS) {
      expect(refused([platform], { title: 'Título' }), platform).toBe(400);
    }
  });

  it('aceita imagem no Instagram e no TikTok', () => {
    expect(refused(['INSTAGRAM'], { media: [IMAGE] })).toBeNull();
    expect(refused(['TIKTOK'], { media: [IMAGE] })).toBeNull();
  });

  // YouTube publica vídeo. Imagem ali não é post nenhum.
  it('recusa imagem no YouTube, e aceita um vídeo com título', () => {
    expect(refused(['YOUTUBE'], { media: [IMAGE], title: 'Título' })).toBe(400);
    expect(refused(['YOUTUBE'], { media: [VIDEO], title: 'Título' })).toBeNull();
  });

  /**
   * O título só existe em `platform_configurations.youtube.title` no provider — o
   * post não tem `title`. Sem ele o YouTube não publica, então a recusa é aqui.
   */
  it('exige título quando o YouTube é destino, e não exige nas outras', () => {
    expect(refused(['YOUTUBE'], { media: [VIDEO] })).toBe(400);
    expect(refused(['YOUTUBE'], { media: [VIDEO], title: '   ' })).toBe(400);
    expect(refused(['X'], { media: [VIDEO] })).toBeNull();
  });

  it('recusa mais de um arquivo no YouTube', () => {
    expect(refused(['YOUTUBE'], { media: [VIDEO, VIDEO], title: 'T' })).toBe(400);
  });

  /**
   * Nenhuma rede publica imagem e vídeo no mesmo post, e a mídia é uma só para
   * todas as contas — escolher um por conta nossa publicaria menos do que o
   * fundador escolheu.
   */
  it('recusa imagem e vídeo no mesmo post', () => {
    expect(refused(['X'], { media: [IMAGE, VIDEO] })).toBe(400);
  });

  it('recusa arquivo de tipo que não sabemos publicar', () => {
    expect(refused(['X'], { media: ['https://cdn.test.aurea/media/ws-1/x.gif'] })).toBe(400);
  });

  // Um post para várias redes vale pela mais restritiva: o vídeo serve ao X e ao
  // YouTube, mas sem título o conjunto cai.
  it('vale pela rede mais restritiva do conjunto', () => {
    expect(refused(['X', 'YOUTUBE'], { media: [VIDEO], title: 'T' })).toBeNull();
    expect(refused(['X', 'YOUTUBE'], { media: [VIDEO] })).toBe(400);
    expect(refused(['X', 'YOUTUBE'], { media: [IMAGE], title: 'T' })).toBe(400);
    expect(refused(['LINKEDIN', 'INSTAGRAM'], {})).toBe(400);
  });

  it('respeita o teto de arquivos de cada rede', () => {
    expect(refused(['X'], { media: [IMAGE, IMAGE2, IMAGE, IMAGE2] })).toBeNull();
    expect(refused(['X'], { media: [IMAGE, IMAGE2, IMAGE, IMAGE2, IMAGE] })).toBe(400);
  });
});

import { SocialPlatform } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { PLATFORM_SLUG, platformFromSlug } from './platforms.js';

describe('PLATFORM_SLUG', () => {
  it('cobre o enum inteiro', () => {
    for (const platform of Object.values(SocialPlatform)) {
      expect(PLATFORM_SLUG[platform]).toBeTruthy();
    }
  });

  it('vai e volta para todas', () => {
    for (const platform of Object.values(SocialPlatform)) {
      expect(platformFromSlug(PLATFORM_SLUG[platform])).toBe(platform);
    }
  });
});

describe('platformFromSlug', () => {
  /**
   * Só o Pinterest fica fora agora, e por motivo do fornecedor: a credencial não
   * está habilitada na conta dele — `auth-url` responde
   * `404 Social provider app credentials not found for pinterest`.
   */
  it('devolve null para rede que a AUREA não modela', () => {
    expect(platformFromSlug('pinterest')).toBeNull();
    expect(platformFromSlug('rede-que-eles-inventarem')).toBeNull();
  });

  // Bluesky publica como as outras; o que a distingue é conectar por senha de app.
  it('reconhece o Bluesky', () => {
    expect(platformFromSlug('bluesky')).toBe(SocialPlatform.BLUESKY);
  });

  // As três que entraram com o upload de mídia.
  it('reconhece as redes que exigem mídia', () => {
    expect(platformFromSlug('instagram')).toBe(SocialPlatform.INSTAGRAM);
    expect(platformFromSlug('tiktok')).toBe(SocialPlatform.TIKTOK);
    expect(platformFromSlug('youtube')).toBe(SocialPlatform.YOUTUBE);
  });

  it('não se importa com caixa', () => {
    expect(platformFromSlug('LinkedIn')).toBe(SocialPlatform.LINKEDIN);
  });
});

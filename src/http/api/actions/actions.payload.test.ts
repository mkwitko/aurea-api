import { describe, expect, it } from 'vitest';
import { ActionType } from '@prisma/client';
import { parseActionPayload, socialPostPayload } from './actions.payload.js';

const VALID = { content: 'Como cortamos 30% do custo operacional em três meses.' };

describe('socialPostPayload', () => {
  it('aceita o texto', () => {
    expect(socialPostPayload.parse(VALID)).toEqual(VALID);
  });

  it('recusa conteúdo vazio', () => {
    expect(socialPostPayload.safeParse({ content: '' }).success).toBe(false);
  });

  it('recusa conteúdo acima de 5000 caracteres', () => {
    expect(socialPostPayload.safeParse({ content: 'a'.repeat(5001) }).success).toBe(false);
  });

  /**
   * O canal saiu do payload: onde o post vai são os alvos, uma linha por rede
   * com o desfecho de cada uma (spec §4.1). Um payload com o snapshot antigo é
   * contrato velho chegando, e `.strict()` o recusa em vez de guardar dado que
   * ninguém lê.
   */
  it('recusa o snapshot de canal do modelo antigo', () => {
    expect(
      socialPostPayload.safeParse({
        ...VALID,
        channelId: 'chan-1',
        channelName: 'AUREA no Instagram',
        providerIdentifier: 'instagram',
      }).success,
    ).toBe(false);
  });

  // Um campo extra no payload é dado que ninguém lê e que a próxima pessoa vai
  // acreditar que funciona.
  it('recusa campo desconhecido', () => {
    expect(socialPostPayload.safeParse({ ...VALID, scheduledAt: '2026-08-05T10:00:00Z' }).success).toBe(false);
  });

  it('aceita até quatro imagens', () => {
    const url = (n: number) => `https://cdn.test.aurea/media/ws/${n}.png`;

    expect(socialPostPayload.safeParse({ ...VALID, media: [url(1)] }).success).toBe(true);
    expect(socialPostPayload.safeParse({ ...VALID, media: [1, 2, 3, 4].map(url) }).success).toBe(true);
    // Quatro é o teto do X, o mais apertado das redes que publicamos.
    expect(socialPostPayload.safeParse({ ...VALID, media: [1, 2, 3, 4, 5].map(url) }).success).toBe(false);
  });

  it('recusa imagem que não é URL', () => {
    expect(socialPostPayload.safeParse({ ...VALID, media: ['media/ws/a.png'] }).success).toBe(false);
    expect(socialPostPayload.safeParse({ ...VALID, media: [''] }).success).toBe(false);
  });

  /**
   * Ausência é ausência: sem `.default([])`. Toda ação criada antes deste campo não
   * tem a chave, e um default faria o conector mandar `media: []` onde o provider
   * espera o campo ausente.
   */
  it('mantém a ausência de imagem como ausência, e não como lista vazia', () => {
    const parsed = socialPostPayload.parse(VALID);

    expect('media' in parsed).toBe(false);
    expect(parsed.media).toBeUndefined();
  });
});

describe('parseActionPayload', () => {
  it('devolve o payload tipado para SOCIAL_POST', () => {
    expect(parseActionPayload(ActionType.SOCIAL_POST, VALID)).toEqual(VALID);
  });

  // `.parse` e não `.safeParse`: o payload é escrito só por nós, e um parse que
  // falha aqui é corrupção — devolver um payload vazio em silêncio a esconderia.
  it('estoura num payload gravado que não é o contrato', () => {
    expect(() => parseActionPayload(ActionType.SOCIAL_POST, { channelId: 'chan-1' })).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { AppError } from '../../../lib/errors.js';
import { assertOwnMedia } from './actions.media.js';

const WORKSPACE = '22222222-2222-2222-2222-222222222222';
const OTHER = '33333333-3333-3333-3333-333333333333';
// `R2_PUBLIC_URL` do ambiente de teste, em vitest.config.ts.
const OURS = `https://cdn.test.aurea/media/${WORKSPACE}/a1b2c3.png`;

function refused(workspaceId: string, media: string[]) {
  try {
    assertOwnMedia(workspaceId, media);
    return null;
  } catch (error) {
    return error instanceof AppError ? error.statusCode : 'not an AppError';
  }
}

describe('assertOwnMedia', () => {
  it('aceita a imagem que saiu do upload deste workspace', () => {
    expect(() => assertOwnMedia(WORKSPACE, [OURS])).not.toThrow();
  });

  it('não tem o que verificar quando não há imagem', () => {
    expect(() => assertOwnMedia(WORKSPACE, undefined)).not.toThrow();
    expect(() => assertOwnMedia(WORKSPACE, [])).not.toThrow();
  });

  /**
   * O motivo de a função existir: a URL vai para a Post for Me, que a **busca**
   * para publicar. Sem esta guarda, o texto do post é revisado por um humano e a
   * imagem é qualquer endereço da internet, trocável depois da aprovação.
   */
  it('recusa imagem hospedada em qualquer outro lugar', () => {
    for (const url of [
      'https://attacker.example/pwn.png',
      'http://localhost:3333/internal.png',
      'https://cdn.test.aurea.attacker.com/media/x.png',
      'https://cdn.test.aurea@attacker.example/x.png',
    ]) {
      expect(refused(WORKSPACE, [url]), url).toBe(400);
    }
  });

  // Isolamento: a chave do objeto carrega o workspace, então a URL de outro
  // tenant é recusada mesmo tendo sido vista.
  it('recusa a imagem de outro workspace', () => {
    expect(refused(WORKSPACE, [OURS.replace(WORKSPACE, OTHER)])).toBe(400);
  });

  // Uma URL boa não pode servir de escolta para uma ruim.
  it('recusa a lista inteira quando uma só URL é de fora', () => {
    expect(refused(WORKSPACE, [OURS, 'https://attacker.example/pwn.png'])).toBe(400);
  });

  // Prefixo do bucket sem o `media/` não basta: um logo é público e não passou
  // pelo allowlist de mídia.
  it('recusa objeto do nosso bucket que não é mídia', () => {
    expect(refused(WORKSPACE, [`https://cdn.test.aurea/logos/${WORKSPACE}/logo.png`])).toBe(400);
  });
});

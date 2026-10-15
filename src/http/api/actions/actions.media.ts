import { env } from '../../../config/env.js';
import { BadRequestError } from '../../../lib/errors.js';

/**
 * Só imagem que saiu do nosso upload entra numa ação.
 *
 * A URL não é decorativa: ela é mandada à Post for Me, que a **busca** para
 * publicar. Aceitar URL arbitrária faria a AUREA um intermediário que manda um
 * terceiro buscar qualquer endereço que um cliente escreva — e publicaria no
 * perfil dele uma imagem que ninguém neste sistema viu, hospedada por quem
 * quiser, trocável depois da aprovação sem que nada aqui perceba.
 *
 * A defesa é a origem, e ela inclui o workspace: `<público>/media/<workspaceId>/`
 * é exatamente a chave que `POST /upload/presigned` escreve para este tenant. É a
 * única prova que temos de que o arquivo passou pelo allowlist de tipo e pelo teto
 * de tamanho — e, de brinde, um workspace não publica a imagem de outro nem tendo
 * visto a URL dela.
 *
 * Sem `R2_PUBLIC_URL` configurada não há origem verificável — e nem upload, que
 * falha antes. Então mídia é recusada inteira, em vez de aceita sem verificação.
 */
export function assertOwnMedia(workspaceId: string, media: string[] | undefined): void {
  if (!media || media.length === 0) return;

  const base = env.R2_PUBLIC_URL?.replace(/\/$/, '');
  if (!base) throw new BadRequestError('Image upload is not configured on this server');

  // A barra final não é enfeite: sem ela, `https://cdn.aurea` casaria com
  // `https://cdn.aurea.attacker.com/x.png`.
  const prefix = `${base}/media/${workspaceId}/`;
  for (const url of media) {
    if (!url.startsWith(prefix)) {
      throw new BadRequestError('Each image must be one uploaded to this workspace', { url });
    }
  }
}

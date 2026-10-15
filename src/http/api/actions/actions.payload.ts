import { ActionType } from '@prisma/client';
import { z } from 'zod';

/**
 * Até quatro arquivos: é o teto do X, o mais apertado das redes que publicam
 * imagem. Quanto cada rede aceita de fato está em `PLATFORM_CAPABILITY` — o
 * YouTube leva um só.
 *
 * Só a forma é verificada aqui, e nunca a origem. Este mesmo schema valida a
 * **resposta** de toda ação já gravada: um dia em que `R2_PUBLIC_URL` mude, uma
 * regra de origem aqui faria toda ação antiga falhar na serialização. A origem é
 * checada na entrada, por `assertOwnMedia`, onde ela pertence.
 */
const mediaField = z.array(z.string().url()).max(4);

/**
 * O payload de um post social: o texto, e as imagens.
 *
 * Onde ele vai não mora aqui — mora em `ActionTarget`, uma linha por rede, com o
 * desfecho de cada uma. O snapshot de canal que existia antes era a forma de uma
 * Action lembrar para onde tinha ido quando havia um canal só; agora o alvo é o
 * registro, e ele guarda também o id e a URL do post real (spec §4.1).
 *
 * 5000 é folgado de propósito: cada rede tem seu limite, o provider corta ou
 * cria thread conforme a dela, e escolher um limite nosso mais apertado
 * recusaria texto que o LinkedIn aceita porque o X não aceitaria.
 */
export const socialPostPayload = z
  .object({
    content: z.string().min(1).max(5000),
    /**
     * Ausente, e não `[]`, quando não há mídia — sem `.default()` de propósito:
     * toda ação criada antes deste campo não tem a chave, e um default faria o
     * conector mandar `media: []` onde o provider espera a ausência do campo.
     */
    media: mediaField.optional(),
    /**
     * O título do vídeo. Existe por causa do YouTube, que não publica sem ele — e
     * o post do provider não tem `title`: o campo só existe dentro de
     * `platform_configurations.youtube`.
     *
     * 100 é o limite do YouTube. Opcional aqui, e exigido em
     * `assertPlatformsAcceptPayload` quando o YouTube é um dos destinos: um título
     * obrigatório para todo post cobraria legenda de quem só quer postar no X.
     */
    title: z.string().min(1).max(100).optional(),
  })
  .strict();

export type SocialPostPayload = z.infer<typeof socialPostPayload>;

/**
 * União discriminada por `type`, com um tipo só. Existe assim para o segundo
 * tipo custar um `case` em vez de uma refatoração.
 *
 * `.parse` e não `.safeParse`: o payload é escrito só por nós, e validado na
 * entrada da rota. Um parse que falha aqui é bug nosso, e um 500 é o sinal
 * certo — devolver silenciosamente um payload vazio esconderia corrupção.
 */
export function parseActionPayload(type: ActionType, payload: unknown): SocialPostPayload {
  switch (type) {
    case ActionType.SOCIAL_POST:
      return socialPostPayload.parse(payload);
  }
}

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PLATFORM_CAPABILITY } from '../actions.capabilities.js';
import { socialPlatformEnum, SOCIAL_PLATFORMS } from '../actions.schema.js';

const capabilitiesResponse = z.object({
  capabilities: z.array(
    z.object({
      platform: socialPlatformEnum,
      requiresMedia: z.boolean(),
      accepts: z.array(z.enum(['IMAGE', 'VIDEO'])),
      maxMedia: z.number().int(),
      requiresTitle: z.boolean(),
    }),
  ),
});

/**
 * O que cada rede aceita — a mesma tabela que a criação usa para recusar.
 *
 * Existe porque a tela precisa dizer "o TikTok precisa de um arquivo" **antes** do
 * clique, e a alternativa era copiar a tabela no frontend. Cópia à mão foi
 * exatamente o defeito de ontem: a tela oferecia retentar um estado que o backend
 * recusava, porque a lista de estados estava escrita duas vezes.
 *
 * Sem escopo de tenant de propósito: é uma constante do produto, igual para todo
 * workspace. Fica atrás de auth como o resto do grupo, e não é segredo — é o
 * mesmo que a documentação pública das redes diz.
 */
export const listCapabilitiesRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/actions/capabilities',
    {
      schema: {
        tags: ['actions'],
        operationId: 'listActionCapabilities',
        response: { 200: capabilitiesResponse },
      },
    },
    async (_req, reply) =>
      reply.send({
        capabilities: SOCIAL_PLATFORMS.map((platform) => {
          const rule = PLATFORM_CAPABILITY[platform];
          return {
            platform,
            requiresMedia: rule.requiresMedia,
            accepts: [...rule.accepts],
            maxMedia: rule.maxMedia,
            // `false` explícito: um `undefined` viraria campo ausente na resposta,
            // e a tela teria de adivinhar o que a ausência significa.
            requiresTitle: rule.requiresTitle ?? false,
          };
        }),
      }),
  );
};

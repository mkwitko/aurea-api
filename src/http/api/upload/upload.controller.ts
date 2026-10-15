import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { getR2Client } from './r2-client.js';
import { FileTypeNotAllowedError, FileTooLargeError, R2NotConfiguredError } from '../../../lib/errors.js';
import { env } from '../../../config/env.js';

// Content type is the single source of truth for the stored object's extension.
// The client-supplied filename is never trusted for it: allowing an arbitrary
// extension lets a caller pass an allowed contentType (image/png) with a
// dangerous extension (.svg) and bypass the allowlist if the CDN serves the
// object by extension. SVG is deliberately absent — it is executable XML and
// would be a stored-XSS vector when served from the public bucket.
const LOGO_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};
const DOC_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'text/plain': '.txt',
  'image/png': '.png',
  'image/jpeg': '.jpg',
};
/**
 * Mídia de post: três imagens e três vídeos.
 *
 * Sem GIF, que nenhuma das redes trata como imagem nem como vídeo de verdade. A
 * extensão gravada aqui é o que decide, depois, se um arquivo é imagem ou vídeo
 * (`mediaKind`): esta tabela é a origem daquela.
 *
 * Proporção, duração e codec **não** são verificados por nós, e não é omissão: a
 * Post for Me processa a mídia que busca (`media[].skip_processing` default falso,
 * verificado no OpenAPI deles), então é o transcode deles que acerta o formato de
 * cada rede. O que checamos é o que podemos: tipo e tamanho.
 */
const MEDIA_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
};
const ALLOWED: Record<UploadKind, Record<string, string>> = {
  logo: LOGO_TYPES,
  document: DOC_TYPES,
  media: MEDIA_TYPES,
};

/**
 * A pasta de cada tipo, escrita à mão.
 *
 * Não é `${type}s`: `media` no plural não existe, e derivar nome de pasta de um
 * valor de enum quebra calado quando o enum cresce.
 */
const KEY_PREFIX: Record<UploadKind, string> = {
  logo: 'logos',
  document: 'documents',
  media: 'media',
};

const MAX_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * O teto do vídeo, por content-type e não por tipo de upload.
 *
 * 10MB não é um vídeo: um Reel de 30 segundos passa disso. 200MB cobre o que as
 * redes publicam de fato e ainda cabe num PUT único do R2 — o limite dele é 5GB,
 * mas um upload de gigabytes de dentro de uma aba do navegador é frágil, e o
 * arquivo ainda precisa ser buscado e transcodificado pelo provider depois.
 *
 * O tamanho continua entrando na assinatura, então este teto é exigível e não um
 * pedido: declarar menos e enviar mais dá `SignatureDoesNotMatch` no R2.
 */
const MAX_VIDEO_SIZE = 200 * 1024 * 1024; // 200MB

function maxSizeFor(contentType: string): number {
  return contentType.startsWith('video/') ? MAX_VIDEO_SIZE : MAX_SIZE;
}

const uploadKind = z.enum(['logo', 'document', 'media']);
type UploadKind = z.infer<typeof uploadKind>;

export const uploadRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/upload/presigned',
    {
      schema: {
        tags: ['upload'],
        operationId: 'createPresignedUpload',
        body: z.object({
          filename: z.string().min(1),
          contentType: z.string().min(1),
          type: uploadKind,
          size: z.number().int().positive(),
        }),
        response: {
          200: z.object({
            uploadUrl: z.string(),
            publicUrl: z.string(),
            key: z.string(),
          }),
        },
      },
    },
    async (req, reply) => {
      const { contentType, type, size } = req.body;

      const ext = ALLOWED[type][contentType];
      if (!ext) {
        throw new FileTypeNotAllowedError({ contentType, type });
      }

      // O teto vem do content-type já validado contra o allowlist: `video/*` só
      // chega aqui se o tipo de upload aceitar vídeo.
      const maxSize = maxSizeFor(contentType);
      if (size > maxSize) {
        throw new FileTooLargeError({ size, maxSize });
      }

      if (!env.R2_ACCOUNT_ID || !env.R2_BUCKET) {
        throw new R2NotConfiguredError();
      }

      /**
       * O workspace na chave do objeto.
       *
       * O bucket é público e a chave tem um UUID, então o segredo é a chave — mas
       * "não adivinhável" não é "isolado": sem o workspace no caminho não há como
       * dizer de quem é um objeto, nem apagar o que sai com um cliente, nem medir
       * consumo por tenant. Objetos antigos ficam onde estão; a URL deles está
       * gravada e continua servindo.
       */
      const key = `${KEY_PREFIX[type]}/${req.tenant.workspaceId}/${randomUUID()}${ext}`;

      const r2 = getR2Client();
      // ContentLength is part of the signature (X-Amz-SignedHeaders includes
      // content-length), so this pins the upload to exactly `size` bytes: a
      // client that declares a small size and then sends more gets
      // SignatureDoesNotMatch from R2. That is what makes MAX_SIZE enforceable.
      const command = new PutObjectCommand({
        Bucket: env.R2_BUCKET!,
        Key: key,
        ContentType: contentType,
        ContentLength: size,
      });

      const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 300 }); // 5 min

      const publicUrl = env.R2_PUBLIC_URL
        ? `${env.R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`
        : uploadUrl.split('?')[0]!;

      return reply.send({ uploadUrl, publicUrl, key });
    },
  );
};

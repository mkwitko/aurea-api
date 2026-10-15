import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../lib/errors.js';
import { uploadRoute } from './upload.controller.js';

const WORKSPACE = '22222222-2222-2222-2222-222222222222';
const OTHER_WORKSPACE = '33333333-3333-3333-3333-333333333333';

async function buildApp(workspaceId = WORKSPACE) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId, role: 'OWNER' };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
    throw error;
  });
  await app.register(uploadRoute);
  return app;
}

function ask(body: Record<string, unknown>) {
  return { method: 'POST' as const, url: '/upload/presigned', payload: body };
}

const image = { filename: 'post.png', contentType: 'image/png', type: 'media', size: 1024 };

describe('POST /upload/presigned', () => {
  it('assina um PUT para a mídia e devolve a URL pública', async () => {
    const app = await buildApp();

    const res = await app.inject(ask(image));

    expect(res.statusCode).toBe(200);
    const body = res.json() as { uploadUrl: string; publicUrl: string; key: string };
    expect(body.key).toMatch(/^media\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/);
    expect(body.publicUrl).toBe(`https://cdn.test.aurea/${body.key}`);
    expect(body.uploadUrl).toContain('X-Amz-Signature');
  });

  /**
   * Isolamento na chave do objeto.
   *
   * O bucket é público, então o UUID é o que esconde o objeto — mas sem o
   * workspace no caminho não há como dizer de quem ele é. A afirmação é que o
   * caminho vem de `req.tenant`, e não do corpo.
   */
  it('põe o workspace de req.tenant na chave, e nunca o do corpo', async () => {
    const app = await buildApp(OTHER_WORKSPACE);

    const res = await app.inject(ask({ ...image, workspaceId: WORKSPACE }));

    expect(res.statusCode).toBe(200);
    const { key } = res.json() as { key: string };
    expect(key).toContain(`media/${OTHER_WORKSPACE}/`);
    expect(key).not.toContain(WORKSPACE);
  });

  it('aceita png, jpeg e webp como mídia', async () => {
    const app = await buildApp();

    for (const [contentType, ext] of [
      ['image/png', '.png'],
      ['image/jpeg', '.jpg'],
      ['image/webp', '.webp'],
    ]) {
      const res = await app.inject(ask({ ...image, contentType }));

      expect(res.statusCode, contentType).toBe(200);
      expect((res.json() as { key: string }).key.endsWith(ext!), contentType).toBe(true);
    }
  });

  /**
   * SVG é XML executável, e este bucket é servido publicamente: um SVG aceito aqui
   * é XSS armazenado, servido do nosso domínio. A extensão vem do content-type
   * justamente para o nome do arquivo do cliente não contornar esta lista.
   */
  it('recusa SVG e qualquer tipo fora da lista, mesmo com nome de arquivo inocente', async () => {
    const app = await buildApp();

    for (const contentType of ['image/svg+xml', 'text/html', 'application/pdf', 'video/x-msvideo', 'image/gif']) {
      const res = await app.inject(ask({ ...image, filename: 'post.png', contentType }));

      expect(res.statusCode, contentType).toBe(400);
    }
  });

  // A lista é por tipo de upload: PDF é documento legítimo e mídia de post não.
  it('mantém as listas separadas por tipo', async () => {
    const app = await buildApp();

    expect((await app.inject(ask({ ...image, type: 'document', contentType: 'application/pdf' }))).statusCode).toBe(200);
    expect((await app.inject(ask({ ...image, type: 'media', contentType: 'application/pdf' }))).statusCode).toBe(400);
  });

  it('aceita mp4, mov e webm como vídeo', async () => {
    const app = await buildApp();

    for (const [contentType, ext] of [
      ['video/mp4', '.mp4'],
      ['video/quicktime', '.mov'],
      ['video/webm', '.webm'],
    ]) {
      const res = await app.inject(ask({ ...image, contentType, size: 50 * 1024 * 1024 }));

      expect(res.statusCode, contentType).toBe(200);
      expect((res.json() as { key: string }).key.endsWith(ext!), contentType).toBe(true);
    }
  });

  /**
   * Vídeo tem teto próprio: 10MB não é um vídeo — um Reel de 30 segundos passa
   * disso. O teto continua entrando na assinatura, então é exigível.
   */
  it('deixa o vídeo passar de 10MB, e para em 200MB', async () => {
    const app = await buildApp();
    const video = { ...image, contentType: 'video/mp4', filename: 'reel.mp4' };

    expect((await app.inject(ask({ ...video, size: 60 * 1024 * 1024 }))).statusCode).toBe(200);
    expect((await app.inject(ask({ ...video, size: 200 * 1024 * 1024 }))).statusCode).toBe(200);
    expect((await app.inject(ask({ ...video, size: 200 * 1024 * 1024 + 1 }))).statusCode).toBe(413);
  });

  // O teto do vídeo não afrouxa o da imagem: 20MB de PNG continua recusado.
  it('mantém o teto de 10MB para imagem', async () => {
    const app = await buildApp();

    expect((await app.inject(ask({ ...image, size: 20 * 1024 * 1024 }))).statusCode).toBe(413);
  });

  it('recusa acima do teto de 10MB', async () => {
    const app = await buildApp();

    const res = await app.inject(ask({ ...image, size: 10 * 1024 * 1024 + 1 }));

    // 413, e não 400: o pedido está bem formado, o arquivo é que não cabe.
    expect(res.statusCode).toBe(413);
  });

  /**
   * O tamanho declarado entra na assinatura (`content-length` em
   * `X-Amz-SignedHeaders`), e é isso que torna o teto exigível: um cliente que
   * declara pouco e envia muito recebe `SignatureDoesNotMatch` do R2.
   */
  it('assina o tamanho declarado, e não só o verifica', async () => {
    const app = await buildApp();

    const res = await app.inject(ask(image));

    expect(decodeURIComponent((res.json() as { uploadUrl: string }).uploadUrl)).toContain('content-length');
  });

  it('recusa um tipo de upload que não existe', async () => {
    const app = await buildApp();

    const res = await app.inject(ask({ ...image, type: 'avatar' }));

    expect(res.statusCode).toBe(400);
  });
});

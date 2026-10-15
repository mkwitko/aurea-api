import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { AppError } from '../lib/errors.js';
import { translateError, getErrorDef } from '../shared/errors/catalog.js';

function negotiateLocale(request: { headers: Record<string, string | string[] | undefined> }): string {
  const raw = request.headers['accept-language'];
  if (!raw) return 'pt-BR';
  const lang = Array.isArray(raw) ? raw[0]! : raw;
  const primary = lang.split(',')[0]!.trim().split(';')[0]!.trim();
  if (primary.startsWith('en')) return 'en-US';
  if (primary.startsWith('es')) return 'es-ES';
  return 'pt-BR';
}

export default fp(async function errorHandlerPlugin(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    const locale = negotiateLocale(request);

    if (hasZodFastifySchemaValidationErrors(error)) {
      const def = getErrorDef('VALIDATION');
      return reply.status(def.status).send({
        error: {
          code: def.code,
          message: translateError(def.code, locale),
          details: error.validation,
        },
      });
    }

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined && { details: error.details }),
        },
      });
    }

    request.log.error({ err: error }, 'Unhandled error');
    const def = getErrorDef('INTERNAL');
    return reply.status(def.status).send({
      error: { code: def.code, message: translateError(def.code, locale) },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    const locale = negotiateLocale(request);
    const def = getErrorDef('NOT_FOUND');
    reply.status(def.status).send({
      error: { code: def.code, message: translateError(def.code, locale) },
    });
  });
});

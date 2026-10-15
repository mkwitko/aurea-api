import type { FastifyPluginAsync } from 'fastify';
import { ForbiddenError, UnauthorizedError } from '../../lib/errors.js';
import { subscribeRunEvents } from '../../ai/events/run-events.js';
import { env } from '../../config/env.js';

const KEEPALIVE_MS = 25_000;

/**
 * GET /events/agent-runs — one long-lived stream per client, fed by
 * `subscribeRunEvents`. This is a latency shortcut, not the source of truth:
 * polling (30s) stays as the fallback, so a dropped stream never leaves the
 * UI stuck.
 *
 * `EventSource` cannot set an Authorization header, so the access token
 * travels as a query param instead. It is verified with the exact same JWT
 * machinery as every other route (`app.jwt.verify`, then `app.resolveTenant`)
 * — the workspace comes out of that verified membership lookup, never off
 * the query string, so a client can only ever land on its own channel.
 */
export const agentRunsSseRoute: FastifyPluginAsync = async (app) => {
  app.get('/events/agent-runs', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const token = typeof query.token === 'string' ? query.token : undefined;
    if (!token) throw new UnauthorizedError('Missing token');

    try {
      request.user = app.jwt.verify(token);
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }

    // `EventSource` also cannot send the `x-workspace-id` header the rest of
    // the app uses to switch workspace, so a picker change travels here as a
    // `workspaceId` query param instead. It is never trusted on its own: the
    // exact same membership lookup `resolveTenant` does for the header runs
    // here before the param can select a channel — no membership, no stream.
    const workspaceIdParam = typeof query.workspaceId === 'string' ? query.workspaceId : undefined;
    if (workspaceIdParam) {
      const membership = await app.prisma.membership.findFirst({
        where: { userId: request.user.sub, workspaceId: workspaceIdParam },
      });
      if (!membership || !membership.workspaceId) throw new ForbiddenError('No access to the requested workspace');
      request.tenant = {
        userId: request.user.sub,
        organizationId: membership.organizationId,
        workspaceId: membership.workspaceId,
        role: membership.role,
      };
    } else {
      // Same membership resolution every authenticated HTTP route uses — the
      // workspace is whatever this decides, never a query param.
      await app.resolveTenant(request, reply);
    }
    const { workspaceId } = request.tenant;

    reply.hijack();
    const res = reply.raw;
    // @fastify/cors seta os headers no `reply`, e `reply.raw.writeHead` não os
    // enxerga — hijack + raw escapa do plugin inteiro. Sem estas duas linhas o
    // browser recusa o stream com "No 'Access-Control-Allow-Origin' header",
    // mesmo com a resposta chegando 200.
    //
    // Ecoa a origem configurada, nunca `*`: o stream é autenticado e escopado
    // por workspace, e `*` é incompatível com credenciais de qualquer forma.
    const cors =
      request.headers.origin === env.CORS_ORIGIN
        ? {
            'Access-Control-Allow-Origin': env.CORS_ORIGIN,
            'Access-Control-Allow-Credentials': 'true',
          }
        : {};

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...cors,
    });
    // Node buffers headers with the first body write otherwise — the client
    // (and any proxy) would see nothing until the first event or keepalive.
    res.flushHeaders();

    const unsubscribe = subscribeRunEvents(workspaceId, (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    // Idle streams get killed by proxies; a comment line is a no-op ping that
    // keeps the connection classified as active.
    const keepalive = setInterval(() => {
      res.write(':\n\n');
    }, KEEPALIVE_MS);

    request.raw.on('close', () => {
      clearInterval(keepalive);
      unsubscribe();
    });
  });
};

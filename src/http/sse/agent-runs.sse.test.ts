import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { agentRunsSseRoute } from './agent-runs.sse.js';
import { publishRunEvent, closeRunEvents } from '../../ai/events/run-events.js';
import { env } from '../../config/env.js';

type Membership = { userId: string; workspaceId: string; organizationId: string; role: string; createdAt: Date };

function membership(userId: string, workspaceId: string): Membership {
  return { userId, workspaceId, organizationId: `org-${workspaceId}`, role: 'MEMBER', createdAt: new Date() };
}

async function buildApp(memberships: Membership[]): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(fastifyJwt, { secret: 'test-secret-at-least-16-chars' });
  app.decorate('prisma', {
    membership: {
      findFirst: async ({ where }: { where: { userId: string; workspaceId: unknown } }) =>
        memberships.find((m) => m.userId === where.userId && m.workspaceId === where.workspaceId) ?? null,
    },
  } as never);
  app.decorate('resolveTenant', async function (this: FastifyInstance, request: never) {
    const req = request as { user?: { sub: string }; tenant?: unknown };
    const m = memberships.find((x) => x.userId === req.user?.sub);
    if (!m) throw new Error('no membership');
    req.tenant = { userId: m.userId, organizationId: m.organizationId, workspaceId: m.workspaceId, role: m.role };
  } as never);
  app.setErrorHandler((error: Error & { statusCode?: number }, _req, reply) => {
    reply.status(error.statusCode ?? 500).send({ error: error.message });
  });
  await app.register(agentRunsSseRoute);
  await app.listen({ port: 0, host: '127.0.0.1' });
  return app;
}

/** Reads SSE `data:` payloads off a fetch stream until `count` are seen or the timeout fires. */
async function readEvents(response: Response, count: number, timeoutMs = 4000): Promise<unknown[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: unknown[] = [];
  let buffer = '';

  const deadline = Date.now() + timeoutMs;
  while (events.length < count && Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: true }>((resolve) => setTimeout(() => resolve({ value: undefined, done: true }), remaining)),
    ]);
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('data: ')) events.push(JSON.parse(line.slice('data: '.length)));
    }
  }
  await reader.cancel().catch(() => {});
  return events;
}

describe('GET /events/agent-runs', () => {
  afterEach(async () => {
    await closeRunEvents();
  });

  it('carries the CORS headers the browser needs', async () => {
    // hijack + reply.raw escapa do @fastify/cors, então estes headers são
    // escritos à mão. Sem eles o browser recusa o stream mesmo com 200 — foi
    // o que aconteceu em produção local.
    const app = await buildApp([membership('u1', 'ws-1')]);
    try {
      const address = app.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const token = app.jwt.sign({ sub: 'u1', email: 'u1@example.com' });
      const controller = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}/events/agent-runs?token=${token}`, {
        headers: { origin: env.CORS_ORIGIN },
        signal: controller.signal,
      });

      expect(res.headers.get('access-control-allow-origin')).toBe(env.CORS_ORIGIN);
      expect(res.headers.get('access-control-allow-credentials')).toBe('true');
      controller.abort();
    } finally {
      await app.close();
    }
  });

  it('refuses a request with no token', async () => {
    const app = await buildApp([membership('u1', 'ws-1')]);
    try {
      const address = app.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const res = await fetch(`http://127.0.0.1:${port}/events/agent-runs`);
      expect(res.status).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('streams an event published for the caller workspace but NOT one published for another workspace', async () => {
    // Security test: two workspaces, two callers. A must never see B's event.
    const app = await buildApp([membership('user-a', 'ws-a'), membership('user-b', 'ws-b')]);
    try {
      const address = app.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const tokenA = app.jwt.sign({ sub: 'user-a', email: 'a@x.com' });

      const controller = new AbortController();
      const streamPromise = fetch(`http://127.0.0.1:${port}/events/agent-runs?token=${tokenA}`, {
        signal: controller.signal,
      });
      const res = await streamPromise;
      expect(res.status).toBe(200);

      const collecting = readEvents(res, 1, 3000);

      // Give the subscription a beat to register before publishing.
      await new Promise((r) => setTimeout(r, 200));
      await publishRunEvent('ws-b', { runId: 'run-other', status: 'COMPLETED' });
      await new Promise((r) => setTimeout(r, 200));
      await publishRunEvent('ws-a', { runId: 'run-mine', status: 'COMPLETED' });

      const events = await collecting;
      controller.abort();

      expect(events).toEqual([{ runId: 'run-mine', status: 'COMPLETED' }]);
    } finally {
      await app.close();
    }
  });

  it('refuses a workspaceId query param the caller is not a member of', async () => {
    const app = await buildApp([membership('user-a', 'ws-a'), membership('user-b', 'ws-b')]);
    try {
      const address = app.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const tokenA = app.jwt.sign({ sub: 'user-a', email: 'a@x.com' });

      const res = await fetch(`http://127.0.0.1:${port}/events/agent-runs?token=${tokenA}&workspaceId=ws-b`);
      expect(res.status).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('streams the requested workspace when the workspaceId query param is a real membership', async () => {
    const app = await buildApp([membership('user-a', 'ws-a'), membership('user-a', 'ws-b')]);
    try {
      const address = app.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const tokenA = app.jwt.sign({ sub: 'user-a', email: 'a@x.com' });

      const controller = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}/events/agent-runs?token=${tokenA}&workspaceId=ws-b`, {
        signal: controller.signal,
      });
      expect(res.status).toBe(200);

      const collecting = readEvents(res, 1, 3000);
      await new Promise((r) => setTimeout(r, 200));
      await publishRunEvent('ws-a', { runId: 'run-other', status: 'COMPLETED' });
      await new Promise((r) => setTimeout(r, 200));
      await publishRunEvent('ws-b', { runId: 'run-mine', status: 'COMPLETED' });

      const events = await collecting;
      controller.abort();

      expect(events).toEqual([{ runId: 'run-mine', status: 'COMPLETED' }]);
    } finally {
      await app.close();
    }
  });
});

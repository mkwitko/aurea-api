import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import {
  createJsonSchemaTransformObject,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { env } from './config/env.js';
import configPlugin from './plugins/config.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import prismaPlugin from './plugins/prisma.js';
import authPlugin from './plugins/auth.js';
import tenantPlugin from './plugins/tenant.js';
import healthRoutes from './modules/health/health.routes.js';
import { authRoutes } from './http/api/auth/index.js';
import { businessRoutes } from './http/api/business/index.js';
import { icpsRoutes } from './http/api/icps/index.js';
import { goalsRoutes } from './http/api/goals/index.js';
import { strategiesRoutes } from './http/api/strategies/index.js';
import { hypothesesRoutes } from './http/api/hypotheses/index.js';
import { experimentsRoutes } from './http/api/experiments/index.js';
import { outcomesRoutes } from './http/api/outcomes/index.js';
import { learningsRoutes } from './http/api/learnings/index.js';
import { uploadRoute } from './http/api/upload/upload.controller.js';
import { agentRunsRoutes } from './http/api/agent-runs/index.js';
import { agentRunsSseRoute } from './http/sse/agent-runs.sse.js';
import { creditsRoutes } from './http/api/credits/index.js';
import { providerKeyRoutes } from './http/api/provider-key/index.js';
import { billingRoutes } from './http/api/billing/index.js';
import { workspacesRoutes } from './http/api/workspaces/index.js';
import { integrationsRoutes } from './http/api/integrations/index.js';
import { actionsRoutes } from './http/api/actions/index.js';
import { dashboardRoutes } from './http/api/dashboard/index.js';
import { stripeWebhookRoute } from './http/webhooks/stripe/stripe-webhook.controller.js';
import { googleCallbackRoute } from './http/api/integrations/google-callback/google-callback.controller.js';
import { businessContextSectionComponentSchemas } from './http/api/business/update-section/update-section.schema.js';
import { startAgentRunWorker } from './ai/queue/worker.js';
import { closeQueue } from './ai/queue/queue.js';
import { closeRunEvents } from './ai/events/run-events.js';
import { flushTracing } from './integrations/tracing/index.js';
import { createAgentRunRepository } from './ai/agent-run/agent-run.repository.js';
import { createBillingPolicy } from './ai/policy.js';
import { createCreditRepository } from './billing/credit.repository.js';
import { createCreditService } from './billing/credit.service.js';
import { createProviderKeyRepository } from './billing/provider-key.repository.js';
import { createProviderKeyService } from './billing/provider-key.service.js';
import { verifyProviderKey } from './billing/verify-provider-key.js';
import { createDeepSeekProvider } from './ai/providers/openai-compatible.js';

export async function buildApp() {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(configPlugin);
  await app.register(errorHandlerPlugin);
  await app.register(helmet);
  await app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });
  await app.register(prismaPlugin);
  await app.register(authPlugin);
  await app.register(tenantPlugin);

  // OpenAPI (contract for the Kubb-generated frontend client)
  await app.register(fastifySwagger, {
    openapi: {
      info: { title: 'AUREA API', version: '0.1.0' },
      servers: [{ url: env.CORS_ORIGIN.replace(':5173', ':3337') }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
    transform: jsonSchemaTransform,
    // Registers the nine business-context section shapes as named
    // `components.schemas` so `updateBusinessContextSection`'s body references
    // them by `$ref` instead of inlining each branch of the discriminated
    // union (see `businessContextSectionComponentSchemas`).
    transformObject: createJsonSchemaTransformObject({ schemas: businessContextSectionComponentSchemas }),
  });
  await app.register(fastifySwaggerUi, { routePrefix: '/docs' });

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(businessRoutes);
  await app.register(icpsRoutes);
  await app.register(goalsRoutes);
  await app.register(strategiesRoutes);
  await app.register(hypothesesRoutes);
  await app.register(experimentsRoutes);
  await app.register(outcomesRoutes);
  await app.register(learningsRoutes);
  await app.register(agentRunsRoutes);
  await app.register(agentRunsSseRoute);
  await app.register(creditsRoutes);
  await app.register(providerKeyRoutes);
  await app.register(billingRoutes);
  await app.register(workspacesRoutes);
  await app.register(dashboardRoutes);
  // Sem STRIPE_WEBHOOK_SECRET a rota não existe: melhor não existir do que
  // existir sem verificação de assinatura.
  if (env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET) {
    await app.register(stripeWebhookRoute);
  }
  // Pública: o Google redireciona o browser sem header. Sem OAuth configurado a
  // rota não existe — melhor não existir do que existir sem cliente para trocar
  // o código, mesma regra do webhook do Stripe acima.
  if (env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REDIRECT_URI) {
    await app.register(googleCallbackRoute);
  }
  await app.register(async (child) => {
    child.addHook('preHandler', app.authenticate);
    child.addHook('preHandler', app.resolveTenant);
    child.addHook('preHandler', app.denyReadOnly);
    await child.register(uploadRoute);
  });
  // `integrationsRoutes` guards writes with `assertAdmin` per-route (like
  // `providerKeyController`), not with `denyReadOnly` — a VIEWER can still be
  // refused, just by role instead of by the generic write guard. It still
  // needs its own auth scope because, unlike `providerKeyRoutes`, it applies
  // no hooks itself (see the comment in integrations/index.ts).
  await app.register(async (child) => {
    child.addHook('preHandler', app.authenticate);
    child.addHook('preHandler', app.resolveTenant);
    await child.register(integrationsRoutes);
  });

  // `actionsRoutes` guards writes with `assertWriter`/`assertAdmin` per-route
  // (same reasoning as `integrationsRoutes` above), not with `denyReadOnly`:
  // GET /actions and GET /actions/:id are open to VIEWER, and `denyReadOnly`
  // would be redundant with the per-route guards for every write anyway. It
  // needs its own auth scope for the same reason `integrationsRoutes` does —
  // it applies no hooks itself, so the plugin can be registered directly
  // against a bare Fastify instance in tests.
  await app.register(async (child) => {
    child.addHook('preHandler', app.authenticate);
    child.addHook('preHandler', app.resolveTenant);
    await child.register(actionsRoutes);
  });

  // O worker de IA NÃO roda aqui. Ele tem processo próprio (`src/worker.ts`,
  // `pnpm worker`) porque, vivendo dentro da API, todo reload do tsx watch e
  // todo deploy matavam os runs em voo — a linha do AgentRun ficava RUNNING
  // para sempre com o crédito já debitado. A API só enfileira; quem executa é
  // o outro processo.
  //
  // closeQueue continua aqui: a API abre a conexão do BullMQ para publicar.
  app.addHook('onClose', closeQueue);

  // A rota SSE abre a conexão subscriber sob demanda (primeiro cliente); se
  // nunca abriu, closeRunEvents() é um no-op.
  app.addHook('onClose', closeRunEvents);

  // Sem Langfuse configurado (dev/CI) nunca há processor para dar flush —
  // flushTracing() é no-op nesse caso.
  app.addHook('onClose', flushTracing);

  return app;
}

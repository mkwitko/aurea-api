import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Env } from '../config/env.js';
import type { TenantContext, OrgTenantContext } from '../lib/tenant.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Env;
    prisma: PrismaClient;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    resolveTenant: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /**
     * Resolve só a organização, para POST /workspaces: é a única rota que um
     * usuário sem workspace precisa alcançar. Deve rodar após `authenticate`.
     */
    resolveOrgTenant: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Refuses unsafe methods for a read-only role. Must run after `resolveTenant`. */
    denyReadOnly: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    // Opcional: em produção cai para createStripeClient; o teste injeta um
    // fake aqui para não tocar a rede.
    stripe?: () => import('../billing/stripe-client.js').StripeClient;
    // Opcional: em produção o webhook monta seu próprio SubscriptionService; o
    // teste injeta um fake aqui para observar o dispatch sem tocar o Prisma real.
    subscriptionsOverride?: import('../billing/subscription.service.js').SubscriptionService;
  }

  interface FastifyRequest {
    tenant: TenantContext;
    /** Preenchido só por `resolveOrgTenant`. Ver `src/lib/tenant.ts`. */
    orgTenant: OrgTenantContext;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string };
    user: { sub: string; email: string };
  }
}

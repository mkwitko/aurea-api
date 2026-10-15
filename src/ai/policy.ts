import { env } from '../config/env.js';
import type { TenantContext } from '../lib/tenant.js';
import type { CreditService } from '../billing/credit.service.js';
import type { ProviderKeyService } from '../billing/provider-key.service.js';

export type RunAuthorization =
  | { allowed: true }
  | { allowed: false; reason: string; required?: number; available?: number };

export type ProviderCredentials = { apiKey: string; source: 'PLATFORM' | 'BYOK' };

export class MissingProviderKeyError extends Error {
  constructor() {
    super('No AI provider key configured (AI_PROVIDER_API_KEY)');
    this.name = 'MissingProviderKeyError';
  }
}

export type AuthorizeRunInput = { taskType: string; agentRunId: string; provider: string };

export type AiPolicy = {
  authorizeRun(tenant: TenantContext, input: AuthorizeRunInput): Promise<RunAuthorization>;
  resolveProviderCredentials(tenant: TenantContext, provider: string): Promise<ProviderCredentials>;
  onRunFailed(tenant: TenantContext, agentRunId: string): Promise<void>;
};

// Policy sem cobrança: usada nos testes do runner e como fallback quando o
// billing não está montado. Libera tudo e nunca estorna.
export function createDefaultPolicy(deps: { apiKey?: string }): AiPolicy {
  return {
    async authorizeRun(): Promise<RunAuthorization> {
      return { allowed: true };
    },

    async resolveProviderCredentials(): Promise<ProviderCredentials> {
      if (!deps.apiKey) throw new MissingProviderKeyError();
      return { apiKey: deps.apiKey, source: 'PLATFORM' };
    },

    async onRunFailed(): Promise<void> {},
  };
}

// A policy é o adaptador entre o runner e o billing: traduz contexto de
// execução em operação comercial. O runner continua sem saber que crédito
// existe, e o billing sem saber que existe um loop de modelo.
export function createBillingPolicy(deps: {
  credits: CreditService;
  keys: ProviderKeyService;
  platformApiKey?: string;
  now?: () => Date;
}): AiPolicy {
  const now = deps.now ?? (() => new Date());

  return {
    async authorizeRun(tenant, input) {
      const byok = await deps.keys.has(tenant.workspaceId, input.provider);

      const result = await deps.credits.authorizeAndCharge({
        workspaceId: tenant.workspaceId,
        taskType: input.taskType,
        agentRunId: input.agentRunId,
        byok,
        now: now(),
      });

      if (result.allowed) return { allowed: true };
      return {
        allowed: false,
        reason: `insufficient credits: needs ${result.required}, has ${result.available}`,
        required: result.required,
        available: result.available,
      };
    },

    async resolveProviderCredentials(tenant, provider) {
      const byok = await deps.keys.reveal(tenant.workspaceId, provider);
      if (byok) return { apiKey: byok, source: 'BYOK' };

      if (!deps.platformApiKey) throw new MissingProviderKeyError();
      return { apiKey: deps.platformApiKey, source: 'PLATFORM' };
    },

    async onRunFailed(_tenant, agentRunId) {
      // No-op quando não houve débito: bloqueio por saldo não gera estorno.
      await deps.credits.refund({ agentRunId, now: now() });
    },
  };
}

export const defaultPolicy: AiPolicy = createDefaultPolicy({ apiKey: env.AI_PROVIDER_API_KEY });

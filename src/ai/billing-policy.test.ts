import { describe, expect, it, vi } from 'vitest';
import { createBillingPolicy } from './policy.js';
import type { CreditService } from '../billing/credit.service.js';
import type { ProviderKeyService } from '../billing/provider-key.service.js';

const tenant = { userId: 'u1', organizationId: 'o1', workspaceId: 'ws-1', role: 'OWNER' as const };
const run = { taskType: 'summarize-business-context', agentRunId: 'run-1', provider: 'deepseek' };

function fake(over: { byok?: boolean; authorize?: unknown } = {}) {
  const credits = {
    authorizeAndCharge: vi.fn().mockResolvedValue(over.authorize ?? { allowed: true, charge: null }),
    refund: vi.fn().mockResolvedValue(undefined),
  } as unknown as CreditService;
  const keys = {
    has: vi.fn().mockResolvedValue(over.byok ?? false),
    reveal: vi.fn().mockResolvedValue(over.byok ? 'sk-byok-1234' : null),
  } as unknown as ProviderKeyService;
  const policy = createBillingPolicy({
    credits,
    keys,
    platformApiKey: 'sk-platform',
    now: () => new Date('2026-07-15T00:00:00Z'),
  });
  return { credits, keys, policy };
}

describe('billing policy', () => {
  it('charges credits for a platform-key run', async () => {
    const { policy, credits } = fake();

    expect(await policy.authorizeRun(tenant, run)).toEqual({ allowed: true });
    expect(credits.authorizeAndCharge).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', agentRunId: 'run-1', byok: false }),
    );
  });

  it('passes byok through so the workspace is not charged', async () => {
    const { policy, credits } = fake({ byok: true });

    await policy.authorizeRun(tenant, run);

    expect(credits.authorizeAndCharge).toHaveBeenCalledWith(expect.objectContaining({ byok: true }));
  });

  it('surfaces the shortfall numbers when blocked', async () => {
    const { policy } = fake({ authorize: { allowed: false, required: 9, available: 2 } });

    const result = await policy.authorizeRun(tenant, run);

    expect(result).toMatchObject({ allowed: false, required: 9, available: 2 });
    if (!result.allowed) expect(result.reason).toMatch(/credit/i);
  });

  it('prefers the workspace key over the platform key', async () => {
    const { policy } = fake({ byok: true });

    expect(await policy.resolveProviderCredentials(tenant, 'deepseek')).toEqual({
      apiKey: 'sk-byok-1234',
      source: 'BYOK',
    });
  });

  it('falls back to the platform key', async () => {
    const { policy } = fake();

    expect(await policy.resolveProviderCredentials(tenant, 'deepseek')).toEqual({
      apiKey: 'sk-platform',
      source: 'PLATFORM',
    });
  });

  it('refunds on failure', async () => {
    const { policy, credits } = fake();

    await policy.onRunFailed(tenant, 'run-1');

    expect(credits.refund).toHaveBeenCalledWith({
      agentRunId: 'run-1',
      now: new Date('2026-07-15T00:00:00Z'),
    });
  });
});

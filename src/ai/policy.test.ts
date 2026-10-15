import { describe, expect, it } from 'vitest';
import { createDefaultPolicy, MissingProviderKeyError } from './policy.js';

const tenant = { userId: 'u1', organizationId: 'o1', workspaceId: 'ws-1', role: 'OWNER' as const };

describe('createDefaultPolicy', () => {
  it('allows every run in B1 — credits arrive in B2', async () => {
    const policy = createDefaultPolicy({ apiKey: 'k' });
    await expect(
      policy.authorizeRun(tenant, {
        taskType: 'summarize-business-context',
        agentRunId: 'run-1',
        provider: 'deepseek',
      }),
    ).resolves.toEqual({ allowed: true });
  });

  it('returns the injected platform key', async () => {
    const policy = createDefaultPolicy({ apiKey: 'sk-test' });
    await expect(policy.resolveProviderCredentials(tenant, 'deepseek')).resolves.toEqual({
      apiKey: 'sk-test',
      source: 'PLATFORM',
    });
  });

  it('fails with a named error when no key was injected', async () => {
    const policy = createDefaultPolicy({});
    await expect(policy.resolveProviderCredentials(tenant, 'deepseek')).rejects.toBeInstanceOf(
      MissingProviderKeyError,
    );
  });

  it('never puts the key in the error message', async () => {
    const policy = createDefaultPolicy({});
    const error = await policy.resolveProviderCredentials(tenant, 'deepseek').catch((e: unknown) => e);
    expect((error as Error).message).not.toContain('sk-');
  });
});

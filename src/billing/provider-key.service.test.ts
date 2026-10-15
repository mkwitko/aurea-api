import { describe, expect, it, vi } from 'vitest';
import { createProviderKeyService } from './provider-key.service.js';
import { seal } from './crypto.js';
import { InvalidProviderKeyError } from '../lib/errors.js';
import type { ProviderKeyRepository } from './provider-key.repository.js';

function fake(over: Record<string, unknown> = {}) {
  const repo = {
    upsert: vi.fn().mockResolvedValue({ last4: '9876', createdAt: new Date('2026-07-01T00:00:00Z') }),
    find: vi.fn().mockResolvedValue(null),
    remove: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
  const verify = vi.fn().mockResolvedValue(true);
  return {
    repo,
    verify,
    service: createProviderKeyService({ repo: repo as unknown as ProviderKeyRepository, verify }),
  };
}

describe('providerKeyService', () => {
  it('verifies the key against the provider before storing it', async () => {
    const { service, repo, verify } = fake();

    await service.put({ workspaceId: 'ws-1', provider: 'deepseek', apiKey: 'sk-live-9876', userId: 'u1' });

    expect(verify).toHaveBeenCalledWith('deepseek', 'sk-live-9876');
    expect(verify.mock.invocationCallOrder[0]!).toBeLessThan(repo.upsert.mock.invocationCallOrder[0]!);
  });

  it('stores nothing when the provider rejects the key', async () => {
    const { service, repo, verify } = fake();
    verify.mockResolvedValue(false);

    await expect(
      service.put({ workspaceId: 'ws-1', provider: 'deepseek', apiKey: 'bad', userId: 'u1' }),
    ).rejects.toBeInstanceOf(InvalidProviderKeyError);

    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('seals the key and keeps only the last four digits in the clear', async () => {
    const { service, repo } = fake();

    await service.put({ workspaceId: 'ws-1', provider: 'deepseek', apiKey: 'sk-live-9876', userId: 'u1' });

    const stored = repo.upsert.mock.calls[0]![0];
    expect(stored.last4).toBe('9876');
    expect(stored.ciphertext.toString('utf8')).not.toContain('sk-live');
    expect(JSON.stringify(stored)).not.toContain('sk-live-9876');
  });

  it('reports no key as configured: false', async () => {
    const { service } = fake();
    expect(await service.status('ws-1', 'deepseek')).toEqual({ configured: false });
  });

  it('reveals the plaintext only through reveal()', async () => {
    const sealed = seal('sk-live-9876');
    const { service } = fake({
      find: vi.fn().mockResolvedValue({
        ...sealed,
        provider: 'deepseek',
        last4: '9876',
        createdAt: new Date('2026-07-01T00:00:00Z'),
      }),
    });

    expect(await service.reveal('ws-1', 'deepseek')).toBe('sk-live-9876');
    expect(await service.status('ws-1', 'deepseek')).toMatchObject({ configured: true, last4: '9876' });
  });

  it('tells whether a workspace has a key without decrypting it', async () => {
    const { service, repo } = fake({ find: vi.fn().mockResolvedValue({ last4: '9876' }) });

    expect(await service.has('ws-1', 'deepseek')).toBe(true);
    expect(repo.find).toHaveBeenCalledWith('ws-1', 'deepseek');
  });
});

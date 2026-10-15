import { last4 as tailOf, open, seal } from './crypto.js';
import { InvalidProviderKeyError } from '../lib/errors.js';
import type { ProviderKeyRepository } from './provider-key.repository.js';

export type ProviderKeyStatus =
  | { configured: false }
  | { configured: true; provider: string; last4: string; createdAt: Date };

export function createProviderKeyService(deps: {
  repo: ProviderKeyRepository;
  verify(provider: string, apiKey: string): Promise<boolean>;
}) {
  const { repo, verify } = deps;

  return {
    // Verificar antes de gravar: chave errada aceita em silêncio só apareceria
    // como run FAILED horas depois, sem pista do porquê.
    async put(input: {
      workspaceId: string;
      provider: string;
      apiKey: string;
      userId: string;
    }): Promise<ProviderKeyStatus> {
      const ok = await verify(input.provider, input.apiKey);
      if (!ok) throw new InvalidProviderKeyError({ provider: input.provider });

      const sealed = seal(input.apiKey);
      const row = await repo.upsert({
        workspaceId: input.workspaceId,
        provider: input.provider,
        ...sealed,
        last4: tailOf(input.apiKey),
        createdBy: input.userId,
        createdAt: new Date(),
      });

      return { configured: true, provider: input.provider, last4: row.last4, createdAt: row.createdAt };
    },

    async status(workspaceId: string, provider: string): Promise<ProviderKeyStatus> {
      const row = await repo.find(workspaceId, provider);
      if (!row) return { configured: false };
      return { configured: true, provider: row.provider, last4: row.last4, createdAt: row.createdAt };
    },

    async has(workspaceId: string, provider: string): Promise<boolean> {
      return (await repo.find(workspaceId, provider)) !== null;
    },

    // Único caminho que devolve texto claro. Nenhuma rota chama isto.
    async reveal(workspaceId: string, provider: string): Promise<string | null> {
      const row = await repo.find(workspaceId, provider);
      if (!row) return null;
      return open({
        ciphertext: Buffer.from(row.ciphertext),
        iv: Buffer.from(row.iv),
        authTag: Buffer.from(row.authTag),
      });
    },

    remove(workspaceId: string, provider: string): Promise<void> {
      return repo.remove(workspaceId, provider);
    },
  };
}

export type ProviderKeyService = ReturnType<typeof createProviderKeyService>;

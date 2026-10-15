import type { PrismaClient } from '@prisma/client';

// Uint8Array, não Buffer: é o que a coluna `Bytes` do Prisma devolve e aceita.
// A conversão para Buffer acontece só na borda da cifra.
export type StoredKey = {
  provider: string;
  ciphertext: Uint8Array;
  iv: Uint8Array;
  authTag: Uint8Array;
  last4: string;
  createdAt: Date;
};

export function createProviderKeyRepository(prisma: PrismaClient) {
  return {
    find(workspaceId: string, provider: string) {
      return prisma.workspaceProviderKey.findUnique({
        where: { workspaceId_provider: { workspaceId, provider } },
        select: { provider: true, ciphertext: true, iv: true, authTag: true, last4: true, createdAt: true },
      });
    },

    upsert(
      input: StoredKey & { workspaceId: string; createdBy: string },
    ): Promise<{ last4: string; createdAt: Date }> {
      return prisma.workspaceProviderKey.upsert({
        where: { workspaceId_provider: { workspaceId: input.workspaceId, provider: input.provider } },
        create: {
          workspaceId: input.workspaceId,
          provider: input.provider,
          ciphertext: new Uint8Array(input.ciphertext),
          iv: new Uint8Array(input.iv),
          authTag: new Uint8Array(input.authTag),
          last4: input.last4,
          createdBy: input.createdBy,
        },
        update: {
          ciphertext: new Uint8Array(input.ciphertext),
          iv: new Uint8Array(input.iv),
          authTag: new Uint8Array(input.authTag),
          last4: input.last4,
          createdBy: input.createdBy,
        },
        select: { last4: true, createdAt: true },
      });
    },

    // deleteMany, não delete: apagar chave inexistente é no-op, não exceção.
    async remove(workspaceId: string, provider: string): Promise<void> {
      await prisma.workspaceProviderKey.deleteMany({ where: { workspaceId, provider } });
    },
  };
}

export type ProviderKeyRepository = ReturnType<typeof createProviderKeyRepository>;

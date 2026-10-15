import type { PrismaClient } from '@prisma/client';

/** Só o que a resposta e o conector precisam. O segredo sai em `find`, e `find` não é rota. */
const PUBLIC_SELECT = {
  id: true,
  provider: true,
  authKind: true,
  externalId: true,
  accountLabel: true,
  status: true,
  lastCheckedAt: true,
  lastError: true,
  createdAt: true,
} as const;

export function createIntegrationsRepository(prisma: PrismaClient) {
  return {
    /** Para a tela: nunca inclui o segredo, por `select` e não por confiança. */
    list(workspaceId: string) {
      return prisma.workspaceIntegration.findMany({
        where: { workspaceId },
        orderBy: { provider: 'asc' },
        select: PUBLIC_SELECT,
      });
    },
    /** Para o conector: inclui o segredo. Nenhum controller devolve isto direto. */
    find(workspaceId: string, provider: string) {
      return prisma.workspaceIntegration.findFirst({ where: { workspaceId, provider } });
    },
    upsert(input: {
      workspaceId: string;
      provider: string;
      authKind: string;
      ciphertext: Buffer;
      iv: Buffer;
      authTag: Buffer;
      externalId: string;
      accountLabel: string;
      createdBy: string;
      checkedAt: Date;
    }) {
      const { workspaceId, provider, createdBy, checkedAt, ciphertext, iv, authTag, ...rest } = input;
      const verified = {
        ...rest,
        // Uint8Array, não Buffer: é o que a coluna `Bytes` do Prisma aceita —
        // mesma conversão de `provider-key.repository.ts`.
        ciphertext: new Uint8Array(ciphertext),
        iv: new Uint8Array(iv),
        authTag: new Uint8Array(authTag),
        status: 'OK',
        lastError: null,
        lastCheckedAt: checkedAt,
      };
      return prisma.workspaceIntegration.upsert({
        where: { workspaceId_provider: { workspaceId, provider } },
        create: { workspaceId, provider, createdBy, ...verified },
        update: verified,
        select: PUBLIC_SELECT,
      });
    },
    /**
     * A linha do provider social.
     *
     * Separada de `upsert` por duas razões. A primeira: grava o resultado da
     * verificação **como ele veio**, inclusive `FAILED` — `upsert` sempre grava
     * `OK` porque só é chamada depois de uma verificação que passou, e aqui
     * recusar em silêncio esconderia um provider que está apenas fora do ar.
     *
     * A segunda: **não há segredo por workspace**. A chave do provider social é da
     * conta AUREA, e o que separa clientes é o profile em `externalId`
     * (spec §3.1). As três colunas de cifra são `Bytes` não-nulas, então o
     * chamador sela um objeto vazio: inventar uma nulidade nova na tabela por
     * causa de um provider mudaria o schema por nada. Nenhuma rota devolve essas
     * colunas — `PUBLIC_SELECT` não as inclui.
     */
    upsertAccountProfile(input: {
      workspaceId: string;
      provider: string;
      ciphertext: Buffer;
      iv: Buffer;
      authTag: Buffer;
      /** O profile do workspace no provider. Não é segredo, e a tela o mostra. */
      externalId: string;
      accountLabel: string;
      createdBy: string;
      status: string;
      lastError: string | null;
      checkedAt: Date;
    }) {
      const { workspaceId, provider, createdBy, checkedAt, ciphertext, iv, authTag, ...rest } = input;
      const written = {
        ...rest,
        // Nem `API_KEY` nem `OAUTH`: a credencial é da conta, não deste
        // workspace, e o discriminador precisa dizer isso.
        authKind: 'ACCOUNT_KEY',
        // Uint8Array, não Buffer: é o que a coluna `Bytes` do Prisma aceita.
        ciphertext: new Uint8Array(ciphertext),
        iv: new Uint8Array(iv),
        authTag: new Uint8Array(authTag),
        lastCheckedAt: checkedAt,
      };
      return prisma.workspaceIntegration.upsert({
        where: { workspaceId_provider: { workspaceId, provider } },
        create: { workspaceId, provider, createdBy, ...written },
        update: written,
        select: PUBLIC_SELECT,
      });
    },
    /**
     * A gravação do OAuth: credencial selada, nenhuma property, `UNVERIFIED`.
     *
     * Separada de `upsert` de propósito. `upsert` grava `status: 'OK'` porque a
     * credencial dela **já** passou por um `health()` na verificação; aqui não
     * houve verificação nenhuma ainda, e marcar OK seria afirmar o que não se
     * sabe.
     */
    upsertOauth(input: {
      workspaceId: string;
      provider: string;
      ciphertext: Buffer;
      iv: Buffer;
      authTag: Buffer;
      accountLabel: string;
      createdBy: string;
      connectedAt: Date;
    }) {
      const { workspaceId, provider, createdBy, connectedAt, ciphertext, iv, authTag, accountLabel } = input;
      const connected = {
        authKind: 'OAUTH',
        accountLabel,
        // Uint8Array, não Buffer: é o que a coluna `Bytes` do Prisma aceita.
        ciphertext: new Uint8Array(ciphertext),
        iv: new Uint8Array(iv),
        authTag: new Uint8Array(authTag),
        // Autorizado, sem property escolhida. Trocar de caminho zera a property
        // do caminho anterior: a credencial nova pode não ver aquela property.
        externalId: null,
        status: 'UNVERIFIED',
        lastError: null,
        lastCheckedAt: connectedAt,
      };
      return prisma.workspaceIntegration.upsert({
        where: { workspaceId_provider: { workspaceId, provider } },
        create: { workspaceId, provider, createdBy, ...connected },
        update: connected,
        select: PUBLIC_SELECT,
      });
    },
    /**
     * A property escolhida e o resultado da verificação, numa escrita só: um
     * update em duas etapas deixaria a linha com property nova e status antigo.
     */
    setProperty(
      id: string,
      externalId: string,
      verified: { status: string; lastError: string | null; checkedAt: Date },
    ) {
      return prisma.workspaceIntegration.update({
        where: { id },
        data: {
          externalId,
          status: verified.status,
          lastError: verified.lastError,
          lastCheckedAt: verified.checkedAt,
        },
        select: PUBLIC_SELECT,
      });
    },
    markFailed(id: string, reason: string, checkedAt: Date) {
      return prisma.workspaceIntegration.update({
        where: { id },
        data: { status: 'FAILED', lastError: reason, lastCheckedAt: checkedAt },
        select: PUBLIC_SELECT,
      });
    },
    remove(workspaceId: string, provider: string) {
      return prisma.workspaceIntegration.deleteMany({ where: { workspaceId, provider } });
    },
  };
}

export type IntegrationsRepository = ReturnType<typeof createIntegrationsRepository>;

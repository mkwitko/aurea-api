import { BadRequestError } from '../../../lib/errors.js';
import { open, seal } from '../../../billing/crypto.js';
import type { IntegrationsRepository } from './integrations.repository.js';

export type VerifyResult = { ok: true; accountLabel: string } | { ok: false; reason: string };

export type VerifyIntegration = (input: {
  provider: string;
  authKind: string;
  externalId: string;
  credentials: string;
}) => Promise<VerifyResult>;

export function createIntegrationsService(deps: {
  repo: IntegrationsRepository;
  verify: VerifyIntegration;
  /** Revoga o refresh token no Google. Ausente ⇒ nada a revogar. */
  revoke?: (credentialsJson: string) => Promise<void>;
}) {
  return {
    list(workspaceId: string) {
      return deps.repo.list(workspaceId);
    },

    /**
     * Verificar antes de gravar, como `provider-key.service.ts` já faz: uma
     * credencial errada aceita em silêncio só apareceria como medição falhando
     * dias depois, sem pista do porquê.
     */
    async put(input: {
      workspaceId: string;
      provider: string;
      authKind: string;
      externalId: string;
      credentials: string;
      userId: string;
      now?: Date;
    }) {
      const verified = await deps.verify({
        provider: input.provider,
        authKind: input.authKind,
        externalId: input.externalId,
        credentials: input.credentials,
      });
      if (!verified.ok) {
        // A mensagem da própria fonte chega ao fundador: "Caller does not have
        // permission" diz o que fazer, "credencial inválida" não diz nada.
        throw new BadRequestError('The source refused this credential', [
          { path: 'credentials', message: verified.reason },
        ]);
      }

      return deps.repo.upsert({
        workspaceId: input.workspaceId,
        provider: input.provider,
        authKind: input.authKind,
        externalId: input.externalId,
        accountLabel: verified.accountLabel,
        createdBy: input.userId,
        checkedAt: input.now ?? new Date(),
        ...seal(input.credentials),
      });
    },

    /**
     * Desconectar de verdade.
     *
     * Guardar um refresh token vivo depois de o fundador ter desconectado é
     * ficar com uma credencial que prometemos parar de ter. A revogação é
     * melhor-esforço: o que ele pediu foi parar de usar, e uma falha do Google
     * não pode impedir a remoção — ele ainda tem a tela dele para revogar do
     * outro lado.
     */
    async remove(workspaceId: string, provider: string) {
      const row = await deps.repo.find(workspaceId, provider);
      if (row?.authKind === 'OAUTH' && deps.revoke) {
        try {
          await deps.revoke(openIntegrationCredential(row));
        } catch {
          // Silêncio deliberado: a remoção segue.
        }
      }
      await deps.repo.remove(workspaceId, provider);
    },
  };
}

/**
 * Único caminho que devolve a credencial em texto claro, para o conector.
 * Nenhuma rota chama isto — mesma regra do `reveal` do provider-key.
 */
export function openIntegrationCredential(row: { ciphertext: Uint8Array; iv: Uint8Array; authTag: Uint8Array }): string {
  return open({
    ciphertext: Buffer.from(row.ciphertext),
    iv: Buffer.from(row.iv),
    authTag: Buffer.from(row.authTag),
  });
}

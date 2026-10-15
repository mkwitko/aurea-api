import type { PrismaClient, Role } from '@prisma/client';
import { uniqueSlug } from '../lib/slug.js';
import { workspaceLimitRepo } from './billing.repository.js';
import { assertCanCreateWorkspace } from './workspace-limit.js';
import { TRIAL_CREDITS } from './plan-catalog.js';

export type CreatedWorkspace = { id: string; name: string; slug: string; createdAt: Date };

export type NewWorkspaceInput = {
  name: string;
  creatorUserId: string;
  creatorRole: Role;
};

// Teto e os dois inserts (workspace + membership) na mesma transação: fora
// dela, duas criações concorrentes no mesmo org podem ler o mesmo `current`
// antes de qualquer insert committar, e as duas passam do teto que
// AUR-T0017 existe para travar.
export async function createWorkspaceForOrg(
  prisma: PrismaClient,
  organizationId: string,
  input: NewWorkspaceInput,
): Promise<CreatedWorkspace> {
  return prisma.$transaction(async (tx) => {
    const existing = await assertCanCreateWorkspace({ repo: workspaceLimitRepo(tx) }, organizationId);

    const created = await tx.workspace.create({
      data: { organizationId, name: input.name, slug: uniqueSlug(input.name) },
      select: { id: true, name: true, slug: true, createdAt: true },
    });

    // Workspace sem membro nenhum é invisível para o resolveTenant e ninguém
    // consegue apagá-lo.
    await tx.membership.create({
      data: { userId: input.creatorUserId, organizationId, workspaceId: created.id, role: input.creatorRole },
    });

    // A ÚNICA exceção sancionada à regra "crédito entra no ledger só por
    // credit.service.grant/grantOnce", herdada do registro. O motivo é a
    // transação: o lançamento no ledger *é* o registro de que o trial foi
    // concedido (não há campo `trialUsed`), então ele tem que commitar junto
    // com o workspace que o recebe. Passar pelo credit.service abriria uma
    // segunda transação e deixaria a janela onde o workspace existe sem o
    // trial, ou o trial existe sem o workspace.
    //
    // Trial é GRANT e não franquia porque franquia renovaria todo mês, para
    // sempre, para quem nunca pagou.
    //
    // `existing === 0` é seguro porque assertCanCreateWorkspace contou com a
    // linha da organização travada: duas criações simultâneas num org vazio
    // não podem ver zero as duas. Só o PRIMEIRO workspace recebe o trial — do
    // segundo em diante vale a franquia do plano.
    if (existing === 0) {
      await tx.creditLedger.create({
        data: { workspaceId: created.id, kind: 'GRANT', credits: TRIAL_CREDITS, reason: 'trial credits' },
      });
    }

    return created;
  });
}

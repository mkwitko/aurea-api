import type { Plan } from '@prisma/client';
import { NotFoundError, WorkspaceLimitReachedError } from '../lib/errors.js';
import { maxWorkspaces } from './plan-catalog.js';

// Funções estreitas, não o tipo inteiro de BillingRepository: quem chama pode
// ser tanto uma checagem solta quanto o `workspaceLimitRepo(tx)` amarrado à
// transação que também vai inserir o workspace — este módulo não precisa
// saber qual dos dois é.
export type WorkspaceLimitDeps = {
  repo: {
    lockOrganization(organizationId: string): Promise<void>;
    organizationById(organizationId: string): Promise<{ plan: Plan } | null>;
    countActiveWorkspaces(organizationId: string): Promise<number>;
  };
};

// A franquia multiplica por workspace: sem teto, um STARTER cria vinte
// workspaces e leva 4.000 créditos por R$297. Este é o freio da margem.
//
// Devolve quantos workspaces ativos a organização JÁ tinha. Quem cria usa esse
// número para saber se este é o primeiro workspace do org (e portanto o que
// recebe o trial); ele vale porque foi lido com a linha da organização travada.
export async function assertCanCreateWorkspace(
  deps: WorkspaceLimitDeps,
  organizationId: string,
): Promise<number> {
  // A trava vem antes de qualquer leitura: sem ela, duas criações concorrentes
  // no mesmo org leem o mesmo `current` antes de qualquer insert committar, e
  // as duas passam do teto — mover a contagem para dentro da transação sem
  // travar a linha não fecha a corrida sob READ COMMITTED.
  await deps.repo.lockOrganization(organizationId);

  const organization = await deps.repo.organizationById(organizationId);
  if (!organization) throw new NotFoundError('Organization not found');

  const current = await deps.repo.countActiveWorkspaces(organizationId);
  const max = maxWorkspaces(organization.plan);
  // `>=` e não `==`: um downgrade pode deixar a org acima do teto, e nesse
  // estado ela também não cria mais nenhum.
  if (current >= max) throw new WorkspaceLimitReachedError({ current, max });
  return current;
}

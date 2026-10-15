import type { Role } from '@prisma/client';
import { ForbiddenError } from './errors.js';

// The resolved tenant for a request. Every domain query is scoped by workspaceId.
export interface TenantContext {
  userId: string;
  organizationId: string;
  workspaceId: string;
  role: Role;
}

/**
 * O tenant de quem ainda não tem workspace. Existe uma rota só nesta situação
 * — POST /workspaces, criando o primeiro — e ela ganha uma propriedade própria
 * em vez de afrouxar `TenantContext.workspaceId` para `string | null`: todo
 * repositório de domínio é escopado por `workspaceId: string`, e o null
 * viajaria por dezenas de rotas que não têm o que fazer com ele, colecionando
 * `!` pelo caminho.
 */
export interface OrgTenantContext {
  userId: string;
  organizationId: string;
  role: Role;
}

/** O que as guardas de papel realmente leem — serve para os dois tenants. */
type HasRole = { role: Role };

// Mutations are denied for VIEWER. Call at the top of write services.
export function assertWriter(tenant: HasRole): void {
  if (tenant.role === 'VIEWER') {
    throw new ForbiddenError('Your role is read-only in this workspace');
  }
}

// Administração do workspace — chave de provider, criação de workspace, compra de
// crédito — é de OWNER/ADMIN. MEMBER escreve conteúdo, não credencial nem gasto.
// A mensagem é genérica de propósito: a mesma guarda cobre várias rotas, e citar
// só uma delas ("manage provider keys") mentia nas outras.
export function assertAdmin(tenant: HasRole): void {
  if (tenant.role !== 'OWNER' && tenant.role !== 'ADMIN') {
    throw new ForbiddenError('Only workspace owners and admins can do this');
  }
}

// Assinar e abrir o portal de cobrança é do OWNER: é quem tem o cartão e o
// CNPJ. ADMIN administra o workspace, não a fatura da organização.
export function assertOwner(tenant: HasRole): void {
  if (tenant.role !== 'OWNER') {
    throw new ForbiddenError('Only the organization owner can manage the subscription');
  }
}

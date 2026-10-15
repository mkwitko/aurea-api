import { describe, expect, it, vi } from 'vitest';
import { createAuthRepository } from '../auth.repository.js';

describe('createAccount', () => {
  function txFake() {
    return {
      organization: { create: vi.fn().mockResolvedValue({ id: 'org-1' }) },
      workspace: { create: vi.fn().mockResolvedValue({ id: 'ws-1' }) },
      user: { create: vi.fn().mockResolvedValue({ id: 'u-1', email: 'a@b.com', name: 'A' }) },
      membership: { create: vi.fn().mockResolvedValue({}) },
      creditLedger: { create: vi.fn().mockResolvedValue({}) },
    };
  }

  async function register(tx: ReturnType<typeof txFake>) {
    const prisma = { $transaction: (fn: (t: unknown) => unknown) => fn(tx) };
    await createAuthRepository(prisma as never).createAccount({
      name: 'A',
      email: 'a@b.com',
      passwordHash: 'hash',
      organizationName: 'Acme',
    });
  }

  // O workspace deixou de ser criado no registro: quem escolhe o nome é o
  // usuário, na tela de primeiro workspace. Um workspace 'Default' aqui é
  // exatamente a regressão que este teste existe para pegar.
  it('creates no workspace', async () => {
    const tx = txFake();
    await register(tx);
    expect(tx.workspace.create).not.toHaveBeenCalled();
  });

  // O trial acompanha o workspace que o recebe (ver createWorkspaceForOrg):
  // sem workspace, não há onde lançar o crédito.
  it('writes no credit ledger entry', async () => {
    const tx = txFake();
    await register(tx);
    expect(tx.creditLedger.create).not.toHaveBeenCalled();
  });

  it('leaves an organization-level OWNER membership', async () => {
    const tx = txFake();
    await register(tx);
    expect(tx.membership.create).toHaveBeenCalledWith({
      data: { userId: 'u-1', organizationId: 'org-1', workspaceId: null, role: 'OWNER' },
    });
  });
});

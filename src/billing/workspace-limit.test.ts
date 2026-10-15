import { describe, expect, it, vi } from 'vitest';
import { assertCanCreateWorkspace } from './workspace-limit.js';

function repoFake(plan: 'STARTER' | 'GROWTH' | 'SCALE', count: number) {
  return {
    lockOrganization: vi.fn().mockResolvedValue(undefined),
    organizationById: vi.fn().mockResolvedValue({ id: 'org-1', plan }),
    countActiveWorkspaces: vi.fn().mockResolvedValue(count),
  };
}

describe('assertCanCreateWorkspace', () => {
  it('lets a plan below its cap through', async () => {
    await expect(assertCanCreateWorkspace({ repo: repoFake('GROWTH', 2) as never }, 'org-1')).resolves.toBe(2);
  });

  it('blocks at the cap and says what the numbers are', async () => {
    await expect(
      assertCanCreateWorkspace({ repo: repoFake('STARTER', 1) as never }, 'org-1'),
    ).rejects.toMatchObject({ code: 'AUR-T0017', details: { current: 1, max: 1 } });
  });

  it('blocks above the cap too, in case a downgrade left it over', async () => {
    await expect(assertCanCreateWorkspace({ repo: repoFake('STARTER', 3) as never }, 'org-1')).rejects.toMatchObject({
      code: 'AUR-T0017',
    });
  });

  // Pino contra a regressão que motivou o Finding 1: se a trava sumir do
  // início da função, dois requests concorrentes voltam a passar do teto.
  it('locks the organization row before counting', async () => {
    const repo = repoFake('GROWTH', 2);
    await assertCanCreateWorkspace({ repo: repo as never }, 'org-1');

    expect(repo.lockOrganization).toHaveBeenCalledWith('org-1');
    const lockOrder = repo.lockOrganization.mock.invocationCallOrder[0] ?? Number.NaN;
    const countOrder = repo.countActiveWorkspaces.mock.invocationCallOrder[0] ?? Number.NaN;
    expect(lockOrder).toBeLessThan(countOrder);
  });

  // createWorkspaceForOrg decide o trial por este número: ele já foi lido com a
  // linha da organização travada, então devolvê-lo evita uma segunda contagem
  // que poderia divergir da que autorizou a criação.
  it('returns how many active workspaces the organization already had', async () => {
    const deps = {
      repo: {
        lockOrganization: vi.fn().mockResolvedValue(undefined),
        organizationById: vi.fn().mockResolvedValue({ plan: 'GROWTH' as const }),
        countActiveWorkspaces: vi.fn().mockResolvedValue(0),
      },
    };

    await expect(assertCanCreateWorkspace(deps, 'org-1')).resolves.toBe(0);
  });
});

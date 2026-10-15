import { describe, expect, it, vi } from 'vitest';
import { createGetIcpTool } from './get-icp.js';

const TENANT = { userId: 'u1', organizationId: 'org-1', workspaceId: 'w1', role: 'MEMBER' as const };

function ctx(icp: unknown) {
  const findFirst = vi.fn().mockResolvedValue(icp);
  return {
    findFirst,
    context: {
      tenant: TENANT,
      prisma: { icp: { findFirst } } as never,
      signal: new AbortController().signal,
    },
  };
}

const ICP = {
  name: 'Head of Growth at Series A SaaS',
  description: 'Owns the number, has no team',
  characteristics: ['20-100 employees'],
  painPoints: ['no time to run experiments'],
  customerGoals: null,
  buyingTriggers: null,
  objections: null,
};

describe('get_icp', () => {
  it('takes no arguments from the model', () => {
    // The id comes from the run input. Injected content must not be able to
    // ask for another workspace's ICP.
    const tool = createGetIcpTool('icp-1');
    expect(tool.argsSchema.safeParse({ icpId: 'someone-elses' }).success).toBe(true);
    expect(tool.name).toBe('get_icp');
  });

  it('scopes the read to the workspace and the captured id', async () => {
    const { findFirst, context } = ctx(ICP);
    await createGetIcpTool('icp-1').execute({}, context);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'icp-1', workspaceId: 'w1', deletedAt: null } }),
    );
  });

  it('returns the ICP', async () => {
    const { context } = ctx(ICP);
    await expect(createGetIcpTool('icp-1').execute({}, context)).resolves.toMatchObject({
      icp: { name: ICP.name },
    });
  });

  it('reports a miss instead of throwing', async () => {
    // A thrown error would kill the run; a reported miss lets the model say it
    // could not read the ICP and return an honest empty proposal.
    const { context } = ctx(null);
    await expect(createGetIcpTool('icp-1').execute({}, context)).resolves.toMatchObject({
      error: expect.stringMatching(/not found/i),
    });
  });
});

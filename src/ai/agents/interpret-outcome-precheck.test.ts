import { describe, expect, it, vi } from 'vitest';
import { interpretOutcomeAgent } from './interpret-outcome.js';
import { ExperimentNotCompletedError, NoOutcomesRecordedError } from '../../lib/errors.js';

const TENANT = { userId: 'u1', organizationId: 'org-1', workspaceId: 'w1', role: 'MEMBER' as const };
const INPUT = { experimentId: '11111111-1111-1111-1111-111111111111' };

function deps(experiment: unknown) {
  return {
    prisma: { experiment: { findFirst: vi.fn().mockResolvedValue(experiment) } } as never,
    tenant: TENANT,
  };
}

describe('interpret-outcome precheck', () => {
  it('passes for a completed experiment with an outcome', async () => {
    const check = interpretOutcomeAgent.precheck;
    expect(check).toBeDefined();
    await expect(check!(INPUT, deps({ status: 'COMPLETED', _count: { outcomes: 1 } }))).resolves.toBeUndefined();
  });

  it('refuses an experiment that has not completed', async () => {
    // Nothing final to interpret — and refusing here means the founder is
    // never charged for a run with nothing to read.
    await expect(
      interpretOutcomeAgent.precheck!(INPUT, deps({ status: 'RUNNING', _count: { outcomes: 3 } })),
    ).rejects.toBeInstanceOf(ExperimentNotCompletedError);
  });

  it('refuses a completed experiment with no outcomes', async () => {
    await expect(
      interpretOutcomeAgent.precheck!(INPUT, deps({ status: 'COMPLETED', _count: { outcomes: 0 } })),
    ).rejects.toBeInstanceOf(NoOutcomesRecordedError);
  });

  it('refuses an experiment in another workspace as not found', async () => {
    await expect(interpretOutcomeAgent.precheck!(INPUT, deps(null))).rejects.toThrowError(/not found/i);
  });

  it('scopes its lookup to the workspace', async () => {
    const d = deps({ status: 'COMPLETED', _count: { outcomes: 1 } });
    await interpretOutcomeAgent.precheck!(INPUT, d);
    expect((d.prisma as unknown as { experiment: { findFirst: ReturnType<typeof vi.fn> } }).experiment.findFirst)
      .toHaveBeenCalledWith(expect.objectContaining({ where: { id: INPUT.experimentId, workspaceId: 'w1' } }));
  });
});

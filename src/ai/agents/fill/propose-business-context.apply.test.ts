import { describe, expect, it, vi } from 'vitest';
import { applyProposedBusinessContext } from './propose-business-context.apply.js';
import type { ProposeContextOutput } from './propose-business-context.js';

const WORKSPACE_ID = 'ws-1';
const RUN_ID = '11111111-1111-1111-1111-111111111111';
const BUSINESS_ID = 'biz-1';

function output(filled: ProposeContextOutput['filled']): ProposeContextOutput {
  return { filled, questions: [], confidence: 'HIGH' };
}

/**
 * Doubles createBusinessRepository's Prisma surface: business.findFirst
 * (getByWorkspace), businessContext.findUnique (getContext), plus the
 * $transaction body addContextVersion runs — same shape as
 * business.repository.test.ts's prismaFake.
 */
function prismaFake(opts: {
  data?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  existingVersionForRun?: boolean;
}) {
  const create = vi.fn().mockResolvedValue({ id: 'ver-2', version: 2 });
  const tx = {
    businessContext: {
      upsert: vi.fn().mockResolvedValue({ id: 'ctx-1', currentVersionId: opts.data || opts.meta ? 'ver-1' : null }),
      update: vi.fn().mockResolvedValue({}),
    },
    businessContextVersion: {
      count: vi.fn().mockResolvedValue(1),
      update: vi.fn().mockResolvedValue({}),
      create,
    },
  };

  return {
    create,
    tx,
    prisma: {
      business: { findFirst: vi.fn().mockResolvedValue({ id: BUSINESS_ID, workspaceId: WORKSPACE_ID }) },
      businessContext: {
        findUnique: vi.fn().mockResolvedValue({
          currentVersion: { data: opts.data ?? {}, meta: opts.meta ?? null },
        }),
      },
      businessContextVersion: {
        findFirst: vi.fn().mockResolvedValue(opts.existingVersionForRun ? { id: 'already-applied' } : null),
      },
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    },
  };
}

describe('applyProposedBusinessContext', () => {
  it('writes a new version, generating an id per proposed product, and stamps AI meta for the sections it filled', async () => {
    const { prisma, create } = prismaFake({});

    await applyProposedBusinessContext(
      output({
        companyProfile: { mission: 'Help founders grow' },
        products: [{ name: 'Aurea', description: 'Growth OS' }],
      }),
      { prisma: prisma as never, workspaceId: WORKSPACE_ID, runId: RUN_ID },
    );

    expect(create).toHaveBeenCalledOnce();
    const written = create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(written.data.data).toMatchObject({
      companyProfile: { mission: 'Help founders grow' },
      products: [expect.objectContaining({ name: 'Aurea', id: expect.any(String) })],
    });
    expect(written.data.meta).toEqual({
      companyProfile: { source: 'AI', sourceAgentRunId: RUN_ID, confidence: 'HIGH' },
      products: { source: 'AI', sourceAgentRunId: RUN_ID, confidence: 'HIGH' },
    });
    expect(written.data.sourceAgentRunId).toBe(RUN_ID);
    expect(written.data.source).toBe('AI');
  });

  it('never overwrites a section whose meta already says a non-AI source', async () => {
    const { prisma, create } = prismaFake({
      data: { companyProfile: { mission: 'Founder-written mission' } },
      meta: { companyProfile: { source: 'USER' } },
    });

    await applyProposedBusinessContext(
      output({ companyProfile: { mission: 'A different, researched mission' } }),
      { prisma: prisma as never, workspaceId: WORKSPACE_ID, runId: RUN_ID },
    );

    // Nothing was eligible to apply, so no version is written at all — the
    // proposal only carried this one section, and it was the founder's.
    expect(create).not.toHaveBeenCalled();
  });

  it('defensively refuses a section that already has content but no meta (written before this field existed)', async () => {
    const { prisma, create } = prismaFake({
      data: { marketContext: { tam: 5_000_000 } },
      // no `meta` at all — legacy version
    });

    await applyProposedBusinessContext(output({ marketContext: { tam: 9_000_000 } }), {
      prisma: prisma as never,
      workspaceId: WORKSPACE_ID,
      runId: RUN_ID,
    });

    expect(create).not.toHaveBeenCalled();
  });

  it('fills a section that is present but empty, even without prior meta', async () => {
    const { prisma, create } = prismaFake({
      data: { constraints: {} },
    });

    await applyProposedBusinessContext(output({ constraints: { regulatoryConstraints: ['GDPR'] } }), {
      prisma: prisma as never,
      workspaceId: WORKSPACE_ID,
      runId: RUN_ID,
    });

    expect(create).toHaveBeenCalledOnce();
    const written = create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(written.data.data).toMatchObject({ constraints: { regulatoryConstraints: ['GDPR'] } });
  });

  it('leaves sections the proposal did not fill untouched, data and meta alike', async () => {
    const { prisma, create } = prismaFake({
      data: { companyProfile: { mission: 'Existing' }, marketContext: { tam: 1 } },
      meta: { companyProfile: { source: 'AI', sourceAgentRunId: 'earlier-run', confidence: 'LOW' } },
    });

    await applyProposedBusinessContext(output({ constraints: { regulatoryConstraints: ['GDPR'] } }), {
      prisma: prisma as never,
      workspaceId: WORKSPACE_ID,
      runId: RUN_ID,
    });

    const written = create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(written.data.data).toMatchObject({ companyProfile: { mission: 'Existing' }, marketContext: { tam: 1 } });
    expect(written.data.meta).toMatchObject({
      companyProfile: { source: 'AI', sourceAgentRunId: 'earlier-run', confidence: 'LOW' },
    });
  });

  it('is idempotent: a version already recorded for this run means the reprocessed job does nothing', async () => {
    const { prisma, create } = prismaFake({ existingVersionForRun: true });

    await applyProposedBusinessContext(output({ companyProfile: { mission: 'Should not be written twice' } }), {
      prisma: prisma as never,
      workspaceId: WORKSPACE_ID,
      runId: RUN_ID,
    });

    expect(create).not.toHaveBeenCalled();
    expect(prisma.business.findFirst).not.toHaveBeenCalled();
  });

  it('does nothing when the business was deleted mid-run', async () => {
    const { prisma, create } = prismaFake({});
    prisma.business.findFirst = vi.fn().mockResolvedValue(null);

    await expect(
      applyProposedBusinessContext(output({ companyProfile: { mission: 'x' } }), {
        prisma: prisma as never,
        workspaceId: WORKSPACE_ID,
        runId: RUN_ID,
      }),
    ).resolves.toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });
});

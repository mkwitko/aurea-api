import { describe, expect, it } from 'vitest';
import { presentContextVersion } from './business.presenter.js';

const BASE_ROW = {
  id: 'ver-1',
  version: 1,
  data: {},
  source: 'USER' as const,
  confidence: 'MEDIUM' as const,
  createdBy: 'u1',
  sourceAgentRunId: null,
  createdAt: new Date('2026-08-01T00:00:00Z'),
  supersededAt: null,
  businessContextId: 'ctx-1',
};

describe('presentContextVersion — sectionMeta', () => {
  it('exposes the per-section provenance stored in meta', () => {
    const presented = presentContextVersion({
      ...BASE_ROW,
      meta: { companyProfile: { source: 'AI', sourceAgentRunId: 'run-1', confidence: 'HIGH' } },
    } as never);

    expect(presented.sectionMeta).toEqual({
      companyProfile: { source: 'AI', sourceAgentRunId: 'run-1', confidence: 'HIGH' },
    });
  });

  it('falls back to an empty object for a version with no meta (legacy or never written)', () => {
    const presented = presentContextVersion({ ...BASE_ROW, meta: null } as never);

    expect(presented.sectionMeta).toEqual({});
  });
});

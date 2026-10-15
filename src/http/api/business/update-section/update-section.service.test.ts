import { describe, expect, it, vi } from 'vitest';
import { updateSectionService } from './update-section.service.js';
import type { UpdateSectionBody } from './update-section.schema.js';

const RUN_ID = '55555555-5555-5555-5555-555555555555';

function deps() {
  const addContextVersion = vi.fn().mockResolvedValue({ id: 'v2' });
  return {
    addContextVersion,
    deps: {
      repo: {
        getByWorkspace: vi.fn().mockResolvedValue({ id: 'b1' }),
        getContext: vi.fn().mockResolvedValue({ currentVersion: { data: { companyProfile: { mission: 'x' } } } }),
        addContextVersion,
      } as never,
    },
  };
}

const body = (extra: Partial<UpdateSectionBody> = {}) =>
  ({ section: 'market', data: { tam: 1000 }, ...extra }) as UpdateSectionBody;

describe('updateSectionService provenance', () => {
  it('records USER when the save carries no run', async () => {
    const { addContextVersion, deps: d } = deps();
    await updateSectionService(d)({ workspaceId: 'w1', userId: 'u1', body: body() });
    expect(addContextVersion).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ source: 'USER', sourceAgentRunId: undefined }),
    );
  });

  it('records AI and the run when the save carries one', async () => {
    // The column and the AI enum member have existed since the first
    // migration and were never fed. Without this the founder could not tell
    // which half of their context they wrote and which half a model proposed.
    const { addContextVersion, deps: d } = deps();
    await updateSectionService(d)({
      workspaceId: 'w1',
      userId: 'u1',
      body: body({ sourceAgentRunId: RUN_ID }),
    });
    expect(addContextVersion).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ source: 'AI', sourceAgentRunId: RUN_ID }),
    );
  });

  it('still merges the section into the stored context', async () => {
    const { addContextVersion, deps: d } = deps();
    await updateSectionService(d)({ workspaceId: 'w1', userId: 'u1', body: body({ sourceAgentRunId: RUN_ID }) });
    const [, version] = addContextVersion.mock.calls[0]!;
    expect(version.data).toMatchObject({
      companyProfile: { mission: 'x' },
      marketContext: { tam: 1000 },
    });
  });
});

describe('updateSectionService section meta', () => {
  it('marks the saved section as USER, even when the save carries the run that proposed it', async () => {
    // The panel's badge comes off the moment a human confirms the section —
    // reviewing an AI proposal and clicking Save is exactly that, so
    // `sourceAgentRunId` on the body must not leave the section meta as AI.
    const { addContextVersion, deps: d } = deps();
    await updateSectionService(d)({ workspaceId: 'w1', userId: 'u1', body: body({ sourceAgentRunId: RUN_ID }) });

    const [, version] = addContextVersion.mock.calls[0]!;
    expect(version.meta).toMatchObject({ marketContext: { source: 'USER' } });
  });

  it('leaves the meta of every other section untouched', async () => {
    const addContextVersion = vi.fn().mockResolvedValue({ id: 'v2' });
    const d = {
      repo: {
        getByWorkspace: vi.fn().mockResolvedValue({ id: 'b1' }),
        getContext: vi.fn().mockResolvedValue({
          currentVersion: {
            data: { companyProfile: { mission: 'x' } },
            meta: { companyProfile: { source: 'AI', sourceAgentRunId: 'earlier-run', confidence: 'MEDIUM' } },
          },
        }),
        addContextVersion,
      } as never,
    };

    await updateSectionService(d)({ workspaceId: 'w1', userId: 'u1', body: body() });

    const [, version] = addContextVersion.mock.calls[0]!;
    expect(version.meta).toMatchObject({
      companyProfile: { source: 'AI', sourceAgentRunId: 'earlier-run', confidence: 'MEDIUM' },
      marketContext: { source: 'USER' },
    });
  });
});

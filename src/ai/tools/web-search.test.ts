import { describe, expect, it, vi } from 'vitest';
import { createWebSearchTool, MAX_SEARCHES_PER_RUN } from './web-search.js';
import type { SearchProvider } from '../../integrations/search/search-provider.js';
import type { ToolContext } from './tool.js';

const ctx = { signal: new AbortController().signal } as ToolContext;

function providerFake(search = vi.fn().mockResolvedValue([{ title: 'A', url: 'https://a.test', content: 'alpha' }])) {
  return { provider: { name: 'fake', search } as SearchProvider, search };
}

describe('web_search tool', () => {
  it('returns the provider results', async () => {
    const { provider } = providerFake();
    const tool = createWebSearchTool(provider);

    await expect(tool.execute({ query: 'ops software demand' }, ctx)).resolves.toEqual({
      results: [{ title: 'A', url: 'https://a.test', content: 'alpha' }],
    });
  });

  it('refuses past the per-run budget instead of throwing', async () => {
    const { provider, search } = providerFake();
    const tool = createWebSearchTool(provider);

    for (let i = 0; i < MAX_SEARCHES_PER_RUN; i += 1) {
      await tool.execute({ query: `q${i}` }, ctx);
    }

    await expect(tool.execute({ query: 'one too many' }, ctx)).resolves.toEqual({
      error: 'search budget exhausted for this run',
    });
    expect(search).toHaveBeenCalledTimes(MAX_SEARCHES_PER_RUN);
  });

  it('spends budget on a failed search too', async () => {
    const search = vi.fn().mockRejectedValue(new Error('provider down'));
    const tool = createWebSearchTool({ name: 'fake', search } as SearchProvider);

    for (let i = 0; i < MAX_SEARCHES_PER_RUN; i += 1) {
      await expect(tool.execute({ query: `q${i}` }, ctx)).rejects.toThrow('provider down');
    }

    await expect(tool.execute({ query: 'one too many' }, ctx)).resolves.toEqual({
      error: 'search budget exhausted for this run',
    });
  });

  it('aborts an in-flight search when the run signal fires, instead of letting it hang', async () => {
    // O provedor nunca resolve por conta própria; só o abort do run deve
    // encerrar a chamada.
    const search = vi.fn().mockImplementation(
      (_query: string, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason as Error));
        }),
    );
    const tool = createWebSearchTool({ name: 'fake', search } as SearchProvider);
    const controller = new AbortController();
    const runCtx = { signal: controller.signal } as ToolContext;

    const pending = tool.execute({ query: 'never resolves' }, runCtx);
    controller.abort(new Error('run cancelled'));

    await expect(pending).rejects.toThrow('run cancelled');
  });

  it('gives each run its own budget', async () => {
    const { provider, search } = providerFake();
    const first = createWebSearchTool(provider);
    for (let i = 0; i < MAX_SEARCHES_PER_RUN; i += 1) await first.execute({ query: `q${i}` }, ctx);

    const second = createWebSearchTool(provider);
    await second.execute({ query: 'fresh run' }, ctx);

    expect(search).toHaveBeenCalledTimes(MAX_SEARCHES_PER_RUN + 1);
  });
});

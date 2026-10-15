import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTavilyProvider } from './tavily.js';
import { SearchProviderError } from './search-provider.js';

const body = (results: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ query: 'q', results }),
});

afterEach(() => vi.unstubAllGlobals());

describe('tavily provider', () => {
  it('maps the provider response to search results', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      body([
        { title: 'A', url: 'https://a.test', content: 'alpha', score: 0.9, raw_content: null },
        { title: 'B', url: 'https://b.test', content: 'beta', score: 0.8, raw_content: null },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const results = await createTavilyProvider('tvly-key').search('growth', AbortSignal.timeout(1000));

    expect(results).toEqual([
      { title: 'A', url: 'https://a.test', content: 'alpha' },
      { title: 'B', url: 'https://b.test', content: 'beta' },
    ]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.tavily.com/search');
    expect((init as { headers: Record<string, string> }).headers.authorization).toBe('Bearer tvly-key');
  });

  it('truncates page content so five results cannot flood the run', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(body([{ title: 'A', url: 'https://a.test', content: 'x'.repeat(5000) }])),
    );

    const [result] = await createTavilyProvider('k').search('growth', AbortSignal.timeout(1000));

    expect(result!.content).toHaveLength(1500);
  });

  it('turns a non-2xx response into a provider error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) }));

    await expect(createTavilyProvider('k').search('growth', AbortSignal.timeout(1000))).rejects.toThrow(
      SearchProviderError,
    );
  });

  it('turns an unreadable response body into a provider error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(body([{ title: 'A' }])));

    await expect(createTavilyProvider('k').search('growth', AbortSignal.timeout(1000))).rejects.toThrow(
      SearchProviderError,
    );
  });

  it('turns a non-JSON response body into a provider error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token in JSON');
        },
      }),
    );

    await expect(createTavilyProvider('k').search('growth', AbortSignal.timeout(1000))).rejects.toThrow(
      SearchProviderError,
    );
  });

  it('falls back to content when raw_content is null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        body([{ title: 'A', url: 'https://a.test', content: 'snippet', raw_content: null }]),
      ),
    );

    const [result] = await createTavilyProvider('k').search('growth', AbortSignal.timeout(1000));

    expect(result!.content).toBe('snippet');
  });

  it('prefers raw_content over content when both are present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        body([
          { title: 'A', url: 'https://a.test', content: 'snippet', raw_content: 'chunk 1 [...] chunk 2' },
        ]),
      ),
    );

    const [result] = await createTavilyProvider('k').search('growth', AbortSignal.timeout(1000));

    expect(result!.content).toBe('chunk 1 [...] chunk 2');
  });
});

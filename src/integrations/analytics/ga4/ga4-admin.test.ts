import { afterEach, describe, expect, it, vi } from 'vitest';
import { listGa4Properties } from './ga4-admin.js';

const mint = () => Promise.resolve('access-token');
const signal = () => AbortSignal.timeout(1000);

function stub(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })),
    ),
  );
}

afterEach(() => vi.unstubAllGlobals());

const SUMMARIES = {
  accountSummaries: [
    {
      account: 'accounts/100',
      displayName: 'Acme Inc',
      propertySummaries: [
        { property: 'properties/123456789', displayName: 'Site institucional', propertyType: 'PROPERTY_TYPE_ORDINARY' },
        { property: 'properties/987654321', displayName: 'App', propertyType: 'PROPERTY_TYPE_ORDINARY' },
      ],
    },
    { account: 'accounts/200', displayName: 'Side project', propertySummaries: [] },
  ],
};

describe('listGa4Properties', () => {
  it('achata as contas em properties com nome e conta', async () => {
    stub(200, SUMMARIES);

    const result = await listGa4Properties(mint, signal());

    expect(result.properties).toEqual([
      { propertyId: '123456789', displayName: 'Site institucional', accountName: 'Acme Inc' },
      { propertyId: '987654321', displayName: 'App', accountName: 'Acme Inc' },
    ]);
    expect(result.truncated).toBe(false);
  });

  it('manda o token e pede a página cheia', async () => {
    stub(200, SUMMARIES);

    await listGa4Properties(mint, signal());

    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://analyticsadmin.googleapis.com/v1beta/accountSummaries');
    expect(url).toContain('pageSize=200');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer access-token');
  });

  // Truncar em silêncio faria uma property ausente parecer inexistente. O corte
  // é declarado, como o de `list_source_metrics`.
  it('declara truncated quando o Google devolve outra página', async () => {
    stub(200, { ...SUMMARIES, nextPageToken: 'more' });

    expect((await listGa4Properties(mint, signal())).truncated).toBe(true);
  });

  it('uma conta sem property não produz linha nenhuma', async () => {
    stub(200, { accountSummaries: [{ account: 'accounts/1', displayName: 'Empty' }] });

    expect((await listGa4Properties(mint, signal())).properties).toEqual([]);
  });

  it('propaga a mensagem da própria fonte quando ela recusa', async () => {
    stub(403, { error: { message: 'Caller does not have permission.' } });

    await expect(listGa4Properties(mint, signal())).rejects.toThrow(/Caller does not have permission/);
  });

  it('recusa um corpo que não é o contrato', async () => {
    stub(200, { unexpected: true });

    await expect(listGa4Properties(mint, signal())).rejects.toThrow(/unreadable/i);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.resetModules();
  vi.unstubAllEnvs();
});

/**
 * `env.ts` lê `process.env` no import e sai. Para exercitar os dois ambientes
 * (com e sem OAuth configurado) o módulo tem de ser importado depois de o env
 * estar montado — daí o import dinâmico e o `resetModules` no afterEach.
 */
async function loadMinter(oauth: boolean) {
  vi.resetModules();
  if (oauth) {
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'client-id');
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'client-secret');
    vi.stubEnv('GOOGLE_OAUTH_REDIRECT_URI', 'http://localhost:3000/integrations/google/callback');
  }
  return await import('./ga4-minter.js');
}

describe('minterFor', () => {
  it('devolve um cunhador para SERVICE_ACCOUNT', async () => {
    const { minterFor } = await loadMinter(false);

    const mint = minterFor('SERVICE_ACCOUNT', JSON.stringify({ client_email: 'a@b.iam.gserviceaccount.com', private_key: 'pk' }));

    expect(typeof mint).toBe('function');
  });

  // Um default silencioso aqui escolheria uma credencial pelo palpite. Um
  // authKind que ninguém implementou é erro, não service account.
  it('estoura em um authKind desconhecido', async () => {
    const { minterFor } = await loadMinter(false);

    expect(() => minterFor('MAGIC', '{}')).toThrow(/unsupported/i);
  });

  it('recusa OAUTH quando o ambiente não tem o client configurado', async () => {
    const { minterFor } = await loadMinter(false);

    expect(() => minterFor('OAUTH', JSON.stringify({ refresh_token: 'rt' }))).toThrow(/not configured/i);
  });

  it('devolve um cunhador para OAUTH quando o client está configurado', async () => {
    const { minterFor } = await loadMinter(true);

    expect(typeof minterFor('OAUTH', JSON.stringify({ refresh_token: 'rt' }))).toBe('function');
  });
});

describe('oauthMinter', () => {
  it('recusa uma credencial que não é JSON', async () => {
    const { oauthMinter } = await import('./ga4-token.js');

    await expect(oauthMinter('not json', { clientId: 'c', clientSecret: 's' })()).rejects.toThrow(/not valid JSON/i);
  });

  it('recusa uma credencial sem refresh_token', async () => {
    const { oauthMinter } = await import('./ga4-token.js');

    await expect(
      oauthMinter(JSON.stringify({ access_token: 'at' }), { clientId: 'c', clientSecret: 's' })(),
    ).rejects.toThrow(/refresh_token/i);
  });
});

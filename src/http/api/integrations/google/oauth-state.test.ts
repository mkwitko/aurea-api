import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { signOAuthState, verifyOAuthState } from './oauth-state.js';

const SECRET = 'a-test-secret-long-enough';

/** O `app.jwt` real, e não um dublê: é ele que assina em produção. */
async function jwt() {
  const app = Fastify();
  await app.register(fastifyJwt, { secret: SECRET, sign: { expiresIn: '15m' } });
  return app.jwt;
}

const STATE = { workspaceId: '22222222-2222-2222-2222-222222222222', userId: 'u1' };

describe('oauth state', () => {
  it('assina e verifica de ida e volta', async () => {
    const j = await jwt();

    expect(verifyOAuthState(j, signOAuthState(j, STATE))).toEqual(STATE);
  });

  it('recusa um token assinado com outro segredo', async () => {
    const mine = await jwt();
    const otherApp = Fastify();
    await otherApp.register(fastifyJwt, { secret: 'a-different-secret-entirely' });

    expect(() => verifyOAuthState(mine, signOAuthState(otherApp.jwt, STATE))).toThrow();
  });

  // A trava que separa as duas famílias de token: um access token do app não
  // pode servir de state.
  it('recusa um access token do app, que não tem purpose', async () => {
    const j = await jwt();
    const accessToken = j.sign({ sub: 'u1', email: 'a@b.com' });

    expect(() => verifyOAuthState(j, accessToken)).toThrow(/state/i);
  });

  it('recusa um token com purpose de outra coisa', async () => {
    const j = await jwt();
    // `sign`'s payload type is narrowed app-wide to `{ sub; email }` (see
    // `src/types/fastify.d.ts`) for the access-token family. This test needs a
    // payload of the *other* shape on purpose, so the cast is deliberate, not
    // a workaround.
    const wrong = j.sign({ ...STATE, purpose: 'password-reset' } as never);

    expect(() => verifyOAuthState(j, wrong)).toThrow(/state/i);
  });

  it('recusa um token expirado', async () => {
    const j = await jwt();
    // `expiresIn: '-1s'` faria o próprio `sign` estourar ("must be a positive
    // number or a valid string") — a biblioteca recusa produzir o token, o que
    // não é o que este teste quer exercitar. Um `exp` explícito no passado
    // produz o token já vencido, que é o caso real.
    const expired = j.sign({ ...STATE, purpose: 'google-oauth', exp: Math.floor(Date.now() / 1000) - 10 } as never);

    expect(() => verifyOAuthState(j, expired)).toThrow();
  });

  // E o vetor contrário: o state não tem `sub`, então ele não passa por onde um
  // Bearer passaria.
  it('não emite sub, para o state não servir de Bearer', async () => {
    const j = await jwt();

    const decoded = j.verify(signOAuthState(j, STATE)) as Record<string, unknown>;

    expect(decoded.sub).toBeUndefined();
    expect(decoded.purpose).toBe('google-oauth');
  });
});

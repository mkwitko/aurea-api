import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // A suíte de integração exige Postgres real e roda em `pnpm test:integration`.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
    // src/config/env.ts fails closed at import time — the app must never boot
    // with invalid configuration. Tests get the minimum valid values here so
    // the suite does not depend on the developer's shell or on a .env file.
    env: {
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      JWT_ACCESS_SECRET: 'test-secret-at-least-16-chars',
      AI_KEY_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
      STRIPE_PRICE_STARTER: 'price_test_starter',
      STRIPE_PRICE_GROWTH: 'price_test_growth',
      STRIPE_PRICE_SCALE: 'price_test_scale',
      STRIPE_PRICE_PACK_SMALL: 'price_test_pack_small',
      STRIPE_PRICE_PACK_MEDIUM: 'price_test_pack_medium',
      STRIPE_PRICE_PACK_LARGE: 'price_test_pack_large',
      // R2: credenciais falsas bastam. `getSignedUrl` assina localmente, sem
      // rede, então o teste do upload afirma a chave e a URL de verdade.
      R2_ACCOUNT_ID: 'test-account',
      R2_ACCESS_KEY_ID: 'test-access-key',
      R2_SECRET_ACCESS_KEY: 'test-secret-key',
      R2_BUCKET: 'test-bucket',
      R2_PUBLIC_URL: 'https://cdn.test.aurea',
    },
  },
});

import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Suíte que exige Postgres real (pnpm infra:up). Fora do `pnpm test` porque CI
// não tem banco — e porque o que ela prova, corrida de transação, nenhum fake
// prova.
//
// O .env é lido aqui porque vitest, ao contrário do tsx, não tem --env-file: sem
// isso o teste roda contra o DATABASE_URL falso da suíte padrão e falha por
// motivo errado.
function dotenv(): Record<string, string> {
  if (!existsSync('.env')) return {};

  return Object.fromEntries(
    readFileSync('.env', 'utf8')
      .split('\n')
      .filter((line) => line.includes('=') && !line.trimStart().startsWith('#'))
      .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]),
  );
}

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    fileParallelism: false,
    env: {
      ...dotenv(),
      JWT_ACCESS_SECRET: 'test-secret-at-least-16-chars',
      AI_KEY_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
    },
  },
});

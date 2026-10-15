# B2a — Ledger de créditos e BYOK: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer a camada de IA cobrar crédito antes de gastar token, estornar quando o run falha, e usar a chave do próprio cliente quando ela existir.

**Architecture:** Um módulo novo `src/billing/` com catálogos em código (plano → franquia, taskType → custo), um ledger append-only no Postgres com débito atômico sob `SELECT ... FOR UPDATE`, e cifra AES-256-GCM para a chave BYOK. `src/ai/policy.ts`, que no B1 é trivial de propósito, vira o adaptador entre o runner e esse módulo. O runner muda em três linhas.

**Tech Stack:** Fastify, Prisma/PostgreSQL, Zod, Vitest, `node:crypto`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-27-ai-billing-b2a-design.md`. Onde o plano e o spec divergirem, o spec ganha — pare e reporte.
- TDD sem exceção: teste que falha antes de qualquer implementação. Rodar e **ver** falhar é um passo, não uma formalidade.
- Nenhuma lógica de cobrança dentro de `src/ai/` fora de `policy.ts`. Nenhuma dependência de Fastify dentro de `src/billing/`.
- Todo erro novo entra em `src/shared/errors/catalog.ts` e nos três locales (`pt-BR`, `en-US`, `es-ES`) com contagem de chaves idêntica.
- Nenhuma resposta HTTP, log ou mensagem de erro pode conter chave de provider, `ciphertext`, `iv` ou `authTag`. Só `last4`.
- `now: Date` entra por parâmetro em toda função que depende do mês. Nada de `new Date()` dentro de regra de negócio.
- Franquia por plano, confirmada com o dono do produto: `STARTER` 200, `GROWTH` 1000, `SCALE` 4000 créditos/mês.
- Crédito é a única unidade que o cliente vê. `estimatedCost`, tokens e preço de modelo são auditoria interna: não entram em nenhuma resposta de `/credits*` nem em mensagem de erro.
- Custo de operação nova se ancora em esforço percebido (1 crédito = uma ação pequena reconhecível; composta = soma das partes), não em COGS.
- Comentário de código explica **por quê**, nunca o que a linha já diz. Português nos comentários, inglês nas mensagens de commit, como no resto do repo.
- Cada task termina com `pnpm typecheck && pnpm test` verdes antes do commit.

## File Structure

```text
prisma/schema.prisma                          Plan, CreditPeriod, CreditLedger, CreditEntryKind, WorkspaceProviderKey

src/billing/
  plan-catalog.ts        Plan → franquia mensal
  operation-cost.ts      taskType → créditos
  crypto.ts              seal/open AES-256-GCM
  credit.repository.ts   período (lock), ledger, saldo — SQL cru onde precisa
  credit.service.ts      authorizeAndCharge, refund, grant, summary
  provider-key.repository.ts
  provider-key.service.ts

src/ai/policy.ts         adaptador runner → billing (reescrito)
src/ai/runner/runner.ts  3 linhas: args da autorização + onRunFailed no fail()

src/http/api/credits/            GET /credits, GET /credits/ledger
src/http/api/provider-key/       GET|PUT|DELETE /ai/provider-key

src/scripts/grant-credits.ts     pnpm ai:grant
vitest.integration.config.ts     suíte que exige Postgres real
```

---

## Task 1: Migration, enum de plano e catálogo de planos

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/billing/plan-catalog.ts`, `src/billing/plan-catalog.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: modelos Prisma `CreditPeriod`, `CreditLedger`, `WorkspaceProviderKey`, enums `Plan` e `CreditEntryKind`, campo `Workspace.plan`; `monthlyAllowance(plan: Plan): number`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/billing/plan-catalog.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Plan } from '@prisma/client';
import { monthlyAllowance } from './plan-catalog.js';

describe('monthlyAllowance', () => {
  it('gives every plan an allowance', () => {
    for (const plan of Object.values(Plan)) {
      expect(monthlyAllowance(plan)).toBeGreaterThan(0);
    }
  });

  it('grows with the plan', () => {
    expect(monthlyAllowance('GROWTH')).toBeGreaterThan(monthlyAllowance('STARTER'));
    expect(monthlyAllowance('SCALE')).toBeGreaterThan(monthlyAllowance('GROWTH'));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/billing/plan-catalog.test.ts`
Expected: FAIL — `Plan` não existe no client e o módulo não existe.

- [ ] **Step 3: Alterar o schema Prisma**

Em `prisma/schema.prisma`, junto dos outros enums:

```prisma
enum Plan {
  STARTER
  GROWTH
  SCALE
}

enum CreditEntryKind {
  DEBIT
  REFUND
  PURCHASE
  GRANT
}
```

No `model Workspace`, acrescentar o campo e as três relações:

```prisma
  plan Plan @default(STARTER)

  creditPeriods CreditPeriod[]
  creditLedger  CreditLedger[]
  providerKeys  WorkspaceProviderKey[]
```

E os três modelos novos:

```prisma
model CreditPeriod {
  id          String   @id @default(uuid())
  workspaceId String
  // Primeiro dia do mês em UTC. A virada é preguiçosa: a linha nasce na
  // primeira autorização do mês, então workspace inativo não tem linha.
  periodStart DateTime
  // Congelado do plano no momento da virada: trocar de plano no meio do mês
  // não muda o que já foi prometido.
  allowance   Int
  consumed    Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, periodStart])
}

model CreditLedger {
  id            String          @id @default(uuid())
  workspaceId   String
  kind          CreditEntryKind
  // Assinado (negativo em DEBIT): é o que o extrato mostra.
  credits       Int
  // Sempre positivos: são o que o cálculo de saldo usa, sem reinterpretar sinal.
  fromAllowance Int             @default(0)
  fromPurchased Int             @default(0)
  agentRunId    String?
  reason        String
  createdAt     DateTime        @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([agentRunId, kind])
  @@index([workspaceId, createdAt])
}

model WorkspaceProviderKey {
  id          String   @id @default(uuid())
  workspaceId String
  provider    String
  ciphertext  Bytes
  iv          Bytes
  authTag     Bytes
  last4       String
  createdBy   String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, provider])
}
```

`@@unique([agentRunId, kind])` é o que torna o estorno idempotente sem código: Postgres
trata `NULL` como distinto, então `PURCHASE`/`GRANT` (sem run) não colidem entre si.

- [ ] **Step 4: Gerar a migration**

```bash
pnpm prisma migrate dev --name billing_b2a
pnpm prisma generate
```

Expected: migration nova em `prisma/migrations/`, client regenerado com `Plan`.

- [ ] **Step 5: Escrever o catálogo**

Criar `src/billing/plan-catalog.ts`:

```ts
import type { Plan } from '@prisma/client';

// Franquia mensal por plano. Vive em código, não no banco, pela mesma razão do
// catálogo de modelos: mudar o que um plano dá é decisão de produto que passa
// por revisão, não UPDATE solto em produção.
const MONTHLY_CREDITS: Record<Plan, number> = {
  STARTER: 200,
  GROWTH: 1_000,
  SCALE: 4_000,
};

export function monthlyAllowance(plan: Plan): number {
  return MONTHLY_CREDITS[plan];
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm vitest run src/billing/plan-catalog.test.ts`
Expected: PASS, 2 testes.

- [ ] **Step 7: Verificar e commitar**

```bash
pnpm typecheck && pnpm test
git add prisma src/billing/plan-catalog.ts src/billing/plan-catalog.test.ts
git commit -m "feat(billing): credit ledger schema and plan allowance catalog"
```

---

## Task 2: Custo por operação

**Files:**
- Create: `src/billing/operation-cost.ts`, `src/billing/operation-cost.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `creditCost(taskType: string): number`, `class UnknownOperationCostError extends Error`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/billing/operation-cost.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { creditCost, UnknownOperationCostError } from './operation-cost.js';

describe('creditCost', () => {
  it('prices the canary agent at one credit', () => {
    expect(creditCost('summarize-business-context')).toBe(1);
  });

  it('refuses an unknown task type instead of charging zero', () => {
    expect(() => creditCost('ghost')).toThrow(UnknownOperationCostError);
  });
});
```

O segundo caso é o que importa: custo zero silencioso para tarefa nova é run de graça em produção.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/billing/operation-cost.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Criar `src/billing/operation-cost.ts`:

```ts
// Crédito é preço ao cliente, não custo de token: um run que escala de tier
// gasta mais dinheiro e continua custando o mesmo crédito. A margem se defende
// no catálogo de planos, não por run.
const CREDITS_BY_TASK: Record<string, number> = {
  'summarize-business-context': 1,
};

export class UnknownOperationCostError extends Error {
  constructor(taskType: string) {
    super(`No credit cost registered for task type: ${taskType}`);
    this.name = 'UnknownOperationCostError';
  }
}

export function creditCost(taskType: string): number {
  const cost = CREDITS_BY_TASK[taskType];
  if (cost === undefined) throw new UnknownOperationCostError(taskType);
  return cost;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/billing/operation-cost.test.ts`
Expected: PASS, 2 testes.

- [ ] **Step 5: Commitar**

```bash
pnpm typecheck && pnpm test
git add src/billing/operation-cost.ts src/billing/operation-cost.test.ts
git commit -m "feat(billing): per-operation credit cost catalog"
```

---

## Task 3: Erros novos e teste de paridade de locales

**Files:**
- Modify: `src/shared/errors/catalog.ts`, `src/shared/errors/i18n/pt-BR.json`, `src/shared/errors/i18n/en-US.json`, `src/shared/errors/i18n/es-ES.json`, `src/lib/errors.ts`
- Create: `src/shared/errors/i18n.test.ts`

**Interfaces:**
- Consumes: `AppError`, `getErrorDef`, `translateError` de `src/lib/errors.ts` / `src/shared/errors/catalog.ts`.
- Produces: `InsufficientCreditsError`, `InvalidProviderKeyError`, `EncryptionNotConfiguredError`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/shared/errors/i18n.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { InsufficientCreditsError } from '../../lib/errors.js';

const dir = new URL('./i18n/', import.meta.url).pathname;

function bundle(file: string): Record<string, string> {
  return JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, string>;
}

describe('error locales', () => {
  it('has the same keys in every locale', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    const reference = Object.keys(bundle(files[0]!)).sort();

    for (const file of files) {
      expect({ file, keys: Object.keys(bundle(file)).sort() }).toEqual({ file, keys: reference });
    }
  });

  it('interpolates the credit numbers the UI needs', () => {
    const error = new InsufficientCreditsError({ required: 9, available: 2 });
    expect(error.message).toContain('9');
    expect(error.message).toContain('2');
  });
});
```

O primeiro teste substitui o `for` de shell que o B1 usava: paridade quebrada vira suíte vermelha, não conferência manual.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/shared/errors/i18n.test.ts`
Expected: FAIL — `InsufficientCreditsError` não existe.

- [ ] **Step 3: Acrescentar ao catálogo**

Em `src/shared/errors/catalog.ts`, dentro de `CATALOG`:

```ts
  INSUFFICIENT_CREDITS: { code: 'AUR-T0013', status: 402 },
  INVALID_PROVIDER_KEY: { code: 'AUR-T0014', status: 400 },
  ENCRYPTION_NOT_CONFIGURED: { code: 'AUR-T0015', status: 500 },
```

- [ ] **Step 4: Acrescentar aos três locales**

`pt-BR.json`:

```json
  "AUR-T0013": "Créditos insuficientes: esta operação custa {{required}} e você tem {{available}}.",
  "AUR-T0014": "A chave informada foi recusada pelo provider {{provider}}.",
  "AUR-T0015": "Cofre de chaves não configurado."
```

`en-US.json`:

```json
  "AUR-T0013": "Not enough credits: this operation costs {{required}} and you have {{available}}.",
  "AUR-T0014": "The key was rejected by provider {{provider}}.",
  "AUR-T0015": "Key vault is not configured."
```

`es-ES.json`:

```json
  "AUR-T0013": "Créditos insuficientes: esta operación cuesta {{required}} y tienes {{available}}.",
  "AUR-T0014": "La clave fue rechazada por el proveedor {{provider}}.",
  "AUR-T0015": "El almacén de claves no está configurado."
```

Lembrar da vírgula na linha anterior (`AUR-T0012`) nos três arquivos.

- [ ] **Step 5: Acrescentar as classes**

No fim de `src/lib/errors.ts`:

```ts
export class InsufficientCreditsError extends AppError {
  constructor(params: { required: number; available: number }) {
    const def = getErrorDef('INSUFFICIENT_CREDITS');
    super(def.status, def.code, translateError(def.code, 'pt-BR', params), params);
  }
}

export class InvalidProviderKeyError extends AppError {
  constructor(params: { provider: string }) {
    const def = getErrorDef('INVALID_PROVIDER_KEY');
    super(def.status, def.code, translateError(def.code, 'pt-BR', params), params);
  }
}

export class EncryptionNotConfiguredError extends AppError {
  constructor() {
    const def = getErrorDef('ENCRYPTION_NOT_CONFIGURED');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm vitest run src/shared/errors/i18n.test.ts`
Expected: PASS, 2 testes.

- [ ] **Step 7: Commitar**

```bash
pnpm typecheck && pnpm test
git add src/shared/errors src/lib/errors.ts
git commit -m "feat(errors): credit and provider-key errors with a locale parity test"
```

---

## Task 4: Cifra da chave BYOK

**Files:**
- Create: `src/billing/crypto.ts`, `src/billing/crypto.test.ts`
- Modify: `src/config/env.ts`, `vitest.config.ts`, `.env.example`

**Interfaces:**
- Consumes: `EncryptionNotConfiguredError` (Task 3).
- Produces:

```ts
export type SealedSecret = { ciphertext: Buffer; iv: Buffer; authTag: Buffer };
export function seal(plaintext: string): SealedSecret;
export function open(sealed: SealedSecret): string;
export function last4(plaintext: string): string;
```

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/billing/crypto.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { last4, open, seal } from './crypto.js';

const KEY = 'sk-live-abcdefghijklmnop9876';

describe('seal/open', () => {
  it('round-trips a secret', () => {
    expect(open(seal(KEY))).toBe(KEY);
  });

  it('never stores the plaintext', () => {
    const sealed = seal(KEY);
    expect(sealed.ciphertext.toString('utf8')).not.toContain('sk-live');
    expect(sealed.ciphertext.toString('hex')).not.toContain(Buffer.from(KEY).toString('hex'));
  });

  it('uses a fresh iv per seal', () => {
    expect(seal(KEY).iv.toString('hex')).not.toBe(seal(KEY).iv.toString('hex'));
  });

  it('refuses a tampered ciphertext', () => {
    const sealed = seal(KEY);
    sealed.ciphertext[0] ^= 0xff;
    expect(() => open(sealed)).toThrow();
  });

  it('refuses a tampered authTag', () => {
    const sealed = seal(KEY);
    sealed.authTag[0] ^= 0xff;
    expect(() => open(sealed)).toThrow();
  });

  it('exposes only the last four characters', () => {
    expect(last4(KEY)).toBe('9876');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/billing/crypto.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Acrescentar a variável ao env**

Em `src/config/env.ts`, junto das outras chaves de IA:

```ts
  // 32 bytes em base64. Validada no boot: chave malformada tem que derrubar o
  // processo, não a primeira gravação de BYOK três dias depois.
  AI_KEY_ENCRYPTION_KEY: optionalText.refine(
    (v) => v === undefined || Buffer.from(v, 'base64').length === 32,
    'AI_KEY_ENCRYPTION_KEY must be 32 bytes encoded as base64',
  ),
```

Em `vitest.config.ts`, no bloco `env`, acrescentar uma chave válida de teste:

```ts
      AI_KEY_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
```

Em `.env.example`, acrescentar com comentário:

```bash
# 32 bytes em base64: openssl rand -base64 32
AI_KEY_ENCRYPTION_KEY=
```

- [ ] **Step 4: Implementar**

Criar `src/billing/crypto.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import { EncryptionNotConfiguredError } from '../lib/errors.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // tamanho recomendado para GCM

export type SealedSecret = { ciphertext: Buffer; iv: Buffer; authTag: Buffer };

function masterKey(): Buffer {
  if (!env.AI_KEY_ENCRYPTION_KEY) throw new EncryptionNotConfiguredError();
  return Buffer.from(env.AI_KEY_ENCRYPTION_KEY, 'base64');
}

export function seal(plaintext: string): SealedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

export function open(sealed: SealedSecret): string {
  const decipher = createDecipheriv(ALGORITHM, masterKey(), sealed.iv);
  decipher.setAuthTag(sealed.authTag);
  // `final()` lança se o authTag não bater: adulteração falha aqui, não silenciosamente.
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString('utf8');
}

export function last4(plaintext: string): string {
  return plaintext.slice(-4);
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm vitest run src/billing/crypto.test.ts`
Expected: PASS, 6 testes.

- [ ] **Step 6: Commitar**

```bash
pnpm typecheck && pnpm test
git add src/billing/crypto.ts src/billing/crypto.test.ts src/config/env.ts vitest.config.ts .env.example
git commit -m "feat(billing): AES-256-GCM sealing for provider keys"
```

---

## Task 5: Repositório de crédito

**Files:**
- Create: `src/billing/credit.repository.ts`, `src/billing/credit.repository.test.ts`

**Interfaces:**
- Consumes: `PrismaClient`.
- Produces:

```ts
export type LedgerEntryInput = {
  workspaceId: string;
  kind: 'DEBIT' | 'REFUND' | 'PURCHASE' | 'GRANT';
  credits: number;
  fromAllowance?: number;
  fromPurchased?: number;
  agentRunId?: string;
  reason: string;
};

export type PeriodRow = { id: string; periodStart: Date; allowance: number; consumed: number };

export type CreditTx = {
  lockPeriod(workspaceId: string, periodStart: Date, allowance: number): Promise<PeriodRow>;
  purchasedBalance(workspaceId: string): Promise<number>;
  addConsumed(periodId: string, delta: number): Promise<void>;
  insertEntry(entry: LedgerEntryInput): Promise<{ id: string }>;
  findEntryByRun(agentRunId: string, kind: 'DEBIT' | 'REFUND'): Promise<
    { id: string; credits: number; fromAllowance: number; fromPurchased: number; createdAt: Date } | null
  >;
  findPeriod(workspaceId: string, periodStart: Date): Promise<PeriodRow | null>;
};

export type CreditRepository = {
  transaction<T>(fn: (tx: CreditTx) => Promise<T>): Promise<T>;
  workspacePlan(workspaceId: string): Promise<Plan>;
  purchasedBalance(workspaceId: string): Promise<number>;
  findPeriod(workspaceId: string, periodStart: Date): Promise<PeriodRow | null>;
  listLedger(workspaceId: string, limit: number, before?: Date): Promise<LedgerRow[]>;
};

export function createCreditRepository(prisma: PrismaClient): CreditRepository;
```

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/billing/credit.repository.test.ts`. Prisma falso, verificando a **forma** das
consultas; a corrida real fica para o teste de integração da Task 12.

```ts
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createCreditRepository } from './credit.repository.js';

function fakePrisma(overrides: Record<string, unknown> = {}) {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([
      { id: 'p-1', periodStart: new Date('2026-07-01T00:00:00Z'), allowance: 200, consumed: 0 },
    ]),
    creditPeriod: { update: vi.fn().mockResolvedValue({}), findUnique: vi.fn().mockResolvedValue(null) },
    creditLedger: { create: vi.fn().mockResolvedValue({ id: 'l-1' }), findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    ...overrides,
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    workspace: { findUniqueOrThrow: vi.fn().mockResolvedValue({ plan: 'GROWTH' }) },
  };
  return { prisma, tx };
}

describe('creditRepository', () => {
  it('creates the period if missing and then locks it', async () => {
    const { prisma, tx } = fakePrisma();
    const repo = createCreditRepository(prisma as unknown as PrismaClient);

    const period = await repo.transaction((t) =>
      t.lockPeriod('ws-1', new Date('2026-07-01T00:00:00Z'), 200),
    );

    expect(tx.$executeRaw).toHaveBeenCalled();           // INSERT ... ON CONFLICT DO NOTHING
    expect(tx.$queryRaw).toHaveBeenCalled();             // SELECT ... FOR UPDATE
    expect(period.id).toBe('p-1');
  });

  it('reads the workspace plan', async () => {
    const { prisma } = fakePrisma();
    const repo = createCreditRepository(prisma as unknown as PrismaClient);

    expect(await repo.workspacePlan('ws-1')).toBe('GROWTH');
  });

  it('records a debit with both buckets', async () => {
    const { prisma, tx } = fakePrisma();
    const repo = createCreditRepository(prisma as unknown as PrismaClient);

    await repo.transaction((t) =>
      t.insertEntry({
        workspaceId: 'ws-1', kind: 'DEBIT', credits: -9,
        fromAllowance: 5, fromPurchased: 4, agentRunId: 'run-1', reason: 'run run-1',
      }),
    );

    const data = tx.creditLedger.create.mock.calls[0]![0].data;
    expect(data.credits).toBe(-9);
    expect(data.fromAllowance).toBe(5);
    expect(data.fromPurchased).toBe(4);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/billing/credit.repository.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Criar `src/billing/credit.repository.ts`:

```ts
import { Prisma } from '@prisma/client';
import type { CreditEntryKind, Plan, PrismaClient } from '@prisma/client';

export type PeriodRow = { id: string; periodStart: Date; allowance: number; consumed: number };

export type LedgerEntryInput = {
  workspaceId: string;
  kind: CreditEntryKind;
  credits: number;
  fromAllowance?: number;
  fromPurchased?: number;
  agentRunId?: string;
  reason: string;
};

export type LedgerRow = {
  id: string;
  kind: CreditEntryKind;
  credits: number;
  agentRunId: string | null;
  reason: string;
  createdAt: Date;
};

type TxClient = Prisma.TransactionClient;

// O saldo comprado nunca soma linhas em memória: uma agregação em SQL sobre o
// ledger é a única fonte, e ela distingue os dois baldes pelas colunas
// fromAllowance/fromPurchased em vez de reinterpretar o sinal de `credits`.
async function purchasedBalanceOn(client: TxClient | PrismaClient, workspaceId: string): Promise<number> {
  const rows = await client.$queryRaw<{ balance: number }[]>`
    SELECT COALESCE(SUM(
      CASE
        WHEN kind IN ('PURCHASE', 'GRANT') THEN credits
        WHEN kind = 'DEBIT'  THEN -"fromPurchased"
        WHEN kind = 'REFUND' THEN  "fromPurchased"
        ELSE 0
      END
    ), 0)::int AS balance
    FROM "CreditLedger"
    WHERE "workspaceId" = ${workspaceId}
  `;
  return rows[0]?.balance ?? 0;
}

function txApi(tx: TxClient) {
  return {
    // Cria-se-não-existe e trava. O INSERT ... ON CONFLICT DO NOTHING evita a
    // corrida entre dois runs que abrem o mês ao mesmo tempo; o FOR UPDATE
    // serializa o débito por workspace.
    async lockPeriod(workspaceId: string, periodStart: Date, allowance: number): Promise<PeriodRow> {
      await tx.$executeRaw`
        INSERT INTO "CreditPeriod" ("id", "workspaceId", "periodStart", "allowance", "consumed", "createdAt", "updatedAt")
        VALUES (gen_random_uuid(), ${workspaceId}, ${periodStart}, ${allowance}, 0, now(), now())
        ON CONFLICT ("workspaceId", "periodStart") DO NOTHING
      `;

      const rows = await tx.$queryRaw<PeriodRow[]>`
        SELECT "id", "periodStart", "allowance", "consumed"
        FROM "CreditPeriod"
        WHERE "workspaceId" = ${workspaceId} AND "periodStart" = ${periodStart}
        FOR UPDATE
      `;

      const period = rows[0];
      if (!period) throw new Error('credit period vanished inside the transaction');
      return period;
    },

    purchasedBalance(workspaceId: string): Promise<number> {
      return purchasedBalanceOn(tx, workspaceId);
    },

    async addConsumed(periodId: string, delta: number): Promise<void> {
      await tx.creditPeriod.update({
        where: { id: periodId },
        data: { consumed: { increment: delta } },
      });
    },

    async insertEntry(entry: LedgerEntryInput): Promise<{ id: string }> {
      const row = await tx.creditLedger.create({
        data: {
          workspaceId: entry.workspaceId,
          kind: entry.kind,
          credits: entry.credits,
          fromAllowance: entry.fromAllowance ?? 0,
          fromPurchased: entry.fromPurchased ?? 0,
          agentRunId: entry.agentRunId ?? null,
          reason: entry.reason,
        },
        select: { id: true },
      });
      return row;
    },

    findEntryByRun(agentRunId: string, kind: CreditEntryKind) {
      return tx.creditLedger.findFirst({
        where: { agentRunId, kind },
        select: { id: true, credits: true, fromAllowance: true, fromPurchased: true, createdAt: true },
      });
    },

    findPeriod(workspaceId: string, periodStart: Date) {
      return tx.creditPeriod.findUnique({
        where: { workspaceId_periodStart: { workspaceId, periodStart } },
        select: { id: true, periodStart: true, allowance: true, consumed: true },
      });
    },
  };
}

export type CreditTx = ReturnType<typeof txApi>;

export function createCreditRepository(prisma: PrismaClient) {
  return {
    transaction<T>(fn: (tx: CreditTx) => Promise<T>): Promise<T> {
      return prisma.$transaction((tx) => fn(txApi(tx)));
    },

    async workspacePlan(workspaceId: string): Promise<Plan> {
      const workspace = await prisma.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { plan: true },
      });
      return workspace.plan;
    },

    purchasedBalance(workspaceId: string): Promise<number> {
      return purchasedBalanceOn(prisma, workspaceId);
    },

    findPeriod(workspaceId: string, periodStart: Date) {
      return prisma.creditPeriod.findUnique({
        where: { workspaceId_periodStart: { workspaceId, periodStart } },
        select: { id: true, periodStart: true, allowance: true, consumed: true },
      });
    },

    listLedger(workspaceId: string, limit: number, before?: Date): Promise<LedgerRow[]> {
      return prisma.creditLedger.findMany({
        where: { workspaceId, ...(before ? { createdAt: { lt: before } } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        select: { id: true, kind: true, credits: true, agentRunId: true, reason: true, createdAt: true },
      });
    },
  };
}

export type CreditRepository = ReturnType<typeof createCreditRepository>;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/billing/credit.repository.test.ts`
Expected: PASS, 3 testes.

- [ ] **Step 5: Commitar**

```bash
pnpm typecheck && pnpm test
git add src/billing/credit.repository.ts src/billing/credit.repository.test.ts
git commit -m "feat(billing): credit repository with a locked period and SQL balance"
```

---

## Task 6: Serviço de crédito

**Files:**
- Create: `src/billing/credit.service.ts`, `src/billing/credit.service.test.ts`

**Interfaces:**
- Consumes: `createCreditRepository` (Task 5), `monthlyAllowance` (Task 1), `creditCost` (Task 2).
- Produces:

```ts
export type AuthorizeResult =
  | { allowed: true; charge: { credits: number; fromAllowance: number; fromPurchased: number; ledgerEntryId: string } | null }
  | { allowed: false; required: number; available: number };

export type CreditSummary = {
  plan: Plan;
  allowance: number;
  consumed: number;
  purchasedBalance: number;
  periodStart: Date;
  periodEnd: Date;
};

export function startOfMonthUtc(now: Date): Date;
export function createCreditService(deps: { repo: CreditRepository }): CreditService;
```

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/billing/credit.service.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createCreditService, startOfMonthUtc } from './credit.service.js';
import type { CreditRepository } from './credit.repository.js';

const NOW = new Date('2026-07-15T10:00:00Z');
const PERIOD = new Date('2026-07-01T00:00:00Z');

function repoFake(over: { allowance?: number; consumed?: number; purchased?: number; debit?: unknown } = {}) {
  const tx = {
    lockPeriod: vi.fn().mockResolvedValue({
      id: 'p-1', periodStart: PERIOD, allowance: over.allowance ?? 200, consumed: over.consumed ?? 0,
    }),
    purchasedBalance: vi.fn().mockResolvedValue(over.purchased ?? 0),
    addConsumed: vi.fn().mockResolvedValue(undefined),
    insertEntry: vi.fn().mockResolvedValue({ id: 'l-1' }),
    findEntryByRun: vi.fn().mockResolvedValue(over.debit ?? null),
    findPeriod: vi.fn().mockResolvedValue({ id: 'p-1', periodStart: PERIOD, allowance: 200, consumed: 5 }),
  };
  const repo = {
    transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    workspacePlan: vi.fn().mockResolvedValue('STARTER'),
    purchasedBalance: vi.fn().mockResolvedValue(over.purchased ?? 0),
    findPeriod: vi.fn().mockResolvedValue({ id: 'p-1', periodStart: PERIOD, allowance: 200, consumed: 5 }),
    listLedger: vi.fn().mockResolvedValue([]),
  };
  return { repo, tx, service: createCreditService({ repo: repo as unknown as CreditRepository }) };
}

const charge = { workspaceId: 'ws-1', taskType: 'summarize-business-context', agentRunId: 'run-1', now: NOW };

describe('startOfMonthUtc', () => {
  it('floors to the first day of the month in UTC', () => {
    expect(startOfMonthUtc(new Date('2026-07-31T23:59:59Z')).toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });
});

describe('authorizeAndCharge', () => {
  it('spends the allowance first', async () => {
    const { service, tx } = repoFake();

    const result = await service.authorizeAndCharge({ ...charge, byok: false });

    expect(result).toMatchObject({ allowed: true });
    const entry = tx.insertEntry.mock.calls[0]![0];
    expect(entry.credits).toBe(-1);
    expect(entry.fromAllowance).toBe(1);
    expect(entry.fromPurchased).toBe(0);
    expect(tx.addConsumed).toHaveBeenCalledWith('p-1', 1);
  });

  it('falls back to purchased credits when the allowance is spent', async () => {
    const { service, tx } = repoFake({ allowance: 1, consumed: 1, purchased: 5 });

    await service.authorizeAndCharge({ ...charge, byok: false });

    const entry = tx.insertEntry.mock.calls[0]![0];
    expect(entry.fromAllowance).toBe(0);
    expect(entry.fromPurchased).toBe(1);
    expect(tx.addConsumed).not.toHaveBeenCalled();
  });

  it('blocks with the numbers the UI needs, writing nothing', async () => {
    const { service, tx } = repoFake({ allowance: 1, consumed: 1, purchased: 0 });

    const result = await service.authorizeAndCharge({ ...charge, byok: false });

    expect(result).toEqual({ allowed: false, required: 1, available: 0 });
    expect(tx.insertEntry).not.toHaveBeenCalled();
  });

  it('never charges a BYOK workspace', async () => {
    const { service, repo } = repoFake();

    const result = await service.authorizeAndCharge({ ...charge, byok: true });

    expect(result).toEqual({ allowed: true, charge: null });
    expect(repo.transaction).not.toHaveBeenCalled();
  });
});

describe('refund', () => {
  it('returns each bucket what it paid', async () => {
    const { service, tx } = repoFake({
      debit: { id: 'l-1', credits: -9, fromAllowance: 5, fromPurchased: 4, createdAt: new Date('2026-07-10T00:00:00Z') },
    });
    tx.findEntryByRun
      .mockResolvedValueOnce({ id: 'l-1', credits: -9, fromAllowance: 5, fromPurchased: 4, createdAt: new Date('2026-07-10T00:00:00Z') })
      .mockResolvedValueOnce(null);

    await service.refund({ agentRunId: 'run-1', now: NOW });

    expect(tx.addConsumed).toHaveBeenCalledWith('p-1', -5);
    const entry = tx.insertEntry.mock.calls[0]![0];
    expect(entry).toMatchObject({ kind: 'REFUND', credits: 9, fromAllowance: 5, fromPurchased: 4 });
  });

  it('does nothing when the run was never charged', async () => {
    const { service, tx } = repoFake();

    await service.refund({ agentRunId: 'run-1', now: NOW });

    expect(tx.insertEntry).not.toHaveBeenCalled();
  });

  it('does not refund twice', async () => {
    const debit = { id: 'l-1', credits: -1, fromAllowance: 1, fromPurchased: 0, createdAt: new Date('2026-07-10T00:00:00Z') };
    const { service, tx } = repoFake();
    tx.findEntryByRun
      .mockResolvedValueOnce(debit)
      .mockResolvedValueOnce({ id: 'l-2', credits: 1, fromAllowance: 1, fromPurchased: 0, createdAt: NOW });

    await service.refund({ agentRunId: 'run-1', now: NOW });

    expect(tx.insertEntry).not.toHaveBeenCalled();
  });

  it('credits the allowance back to the period that charged it', async () => {
    const { service, tx } = repoFake();
    tx.findEntryByRun
      .mockResolvedValueOnce({ id: 'l-1', credits: -1, fromAllowance: 1, fromPurchased: 0, createdAt: new Date('2026-06-30T23:00:00Z') })
      .mockResolvedValueOnce(null);

    await service.refund({ agentRunId: 'run-1', now: NOW });

    expect(tx.findPeriod).toHaveBeenCalledWith('ws-1', new Date('2026-06-01T00:00:00Z'));
  });
});

describe('summary', () => {
  it('reports the current period without creating one', async () => {
    const { service, repo } = repoFake({ purchased: 12 });

    const summary = await service.summary('ws-1', NOW);

    expect(summary).toMatchObject({ plan: 'STARTER', consumed: 5, purchasedBalance: 12 });
    expect(summary.periodStart.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(summary.periodEnd.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(repo.transaction).not.toHaveBeenCalled();
  });

  it('reports a full allowance for a workspace that never ran anything', async () => {
    const { service, repo } = repoFake();
    repo.findPeriod.mockResolvedValue(null);

    const summary = await service.summary('ws-1', NOW);

    expect(summary.allowance).toBe(200);
    expect(summary.consumed).toBe(0);
  });
});
```

O teste do estorno em período anterior é o que fixa a regra: a franquia volta para o mês
que a cobrou, achado pelo `createdAt` do débito.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/billing/credit.service.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Criar `src/billing/credit.service.ts`:

```ts
import type { Plan } from '@prisma/client';
import { monthlyAllowance } from './plan-catalog.js';
import { creditCost } from './operation-cost.js';
import type { CreditRepository } from './credit.repository.js';

export type CreditCharge = {
  credits: number;
  fromAllowance: number;
  fromPurchased: number;
  ledgerEntryId: string;
};

export type AuthorizeResult =
  | { allowed: true; charge: CreditCharge | null }
  | { allowed: false; required: number; available: number };

export type CreditSummary = {
  plan: Plan;
  allowance: number;
  consumed: number;
  purchasedBalance: number;
  periodStart: Date;
  periodEnd: Date;
};

export function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function nextMonthUtc(periodStart: Date): Date {
  return new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1));
}

export function createCreditService(deps: { repo: CreditRepository }) {
  const { repo } = deps;

  return {
    // Débito e verificação na mesma transação, com a linha do período travada:
    // é o que impede dois runs simultâneos de passarem com um crédito só.
    async authorizeAndCharge(input: {
      workspaceId: string;
      taskType: string;
      agentRunId: string;
      byok: boolean;
      now: Date;
    }): Promise<AuthorizeResult> {
      // Chave do cliente, conta do cliente: BYOK não consome crédito.
      if (input.byok) return { allowed: true, charge: null };

      const required = creditCost(input.taskType);
      const plan = await repo.workspacePlan(input.workspaceId);
      const periodStart = startOfMonthUtc(input.now);

      return repo.transaction(async (tx) => {
        const period = await tx.lockPeriod(input.workspaceId, periodStart, monthlyAllowance(plan));
        const purchased = await tx.purchasedBalance(input.workspaceId);

        const allowanceLeft = Math.max(0, period.allowance - period.consumed);
        const available = allowanceLeft + purchased;
        if (available < required) return { allowed: false, required, available };

        const fromAllowance = Math.min(required, allowanceLeft);
        const fromPurchased = required - fromAllowance;

        if (fromAllowance > 0) await tx.addConsumed(period.id, fromAllowance);

        const entry = await tx.insertEntry({
          workspaceId: input.workspaceId,
          kind: 'DEBIT',
          credits: -required,
          fromAllowance,
          fromPurchased,
          agentRunId: input.agentRunId,
          reason: `agent run ${input.agentRunId} (${input.taskType})`,
        });

        return {
          allowed: true,
          charge: { credits: required, fromAllowance, fromPurchased, ledgerEntryId: entry.id },
        };
      });
    },

    // Falha nossa não é cobrança do cliente. Idempotente: o índice único
    // (agentRunId, kind) fecha a porta mesmo numa retentativa concorrente.
    async refund(input: { agentRunId: string; now: Date }): Promise<void> {
      await repo.transaction(async (tx) => {
        const debit = await tx.findEntryByRun(input.agentRunId, 'DEBIT');
        if (!debit) return;

        const already = await tx.findEntryByRun(input.agentRunId, 'REFUND');
        if (already) return;

        const workspaceId = await repo.workspaceOfRun(input.agentRunId);

        if (debit.fromAllowance > 0) {
          // A franquia volta para o mês que a cobrou, não para o mês corrente.
          const period = await tx.findPeriod(workspaceId, startOfMonthUtc(debit.createdAt));
          if (period) await tx.addConsumed(period.id, -debit.fromAllowance);
        }

        await tx.insertEntry({
          workspaceId,
          kind: 'REFUND',
          credits: -debit.credits,
          fromAllowance: debit.fromAllowance,
          fromPurchased: debit.fromPurchased,
          agentRunId: input.agentRunId,
          reason: `refund for failed agent run ${input.agentRunId}`,
        });
      });
    },

    async grant(input: { workspaceId: string; credits: number; reason: string }): Promise<void> {
      if (input.credits <= 0) throw new Error('grant credits must be positive');

      await repo.transaction((tx) =>
        tx.insertEntry({
          workspaceId: input.workspaceId,
          kind: 'GRANT',
          credits: input.credits,
          reason: input.reason,
        }),
      );
    },

    async summary(workspaceId: string, now: Date): Promise<CreditSummary> {
      const plan = await repo.workspacePlan(workspaceId);
      const periodStart = startOfMonthUtc(now);
      const period = await repo.findPeriod(workspaceId, periodStart);
      const purchasedBalance = await repo.purchasedBalance(workspaceId);

      return {
        plan,
        // Workspace que nunca rodou nada não tem linha de período, e isso é
        // certo: ele tem a franquia inteira do plano à disposição.
        allowance: period?.allowance ?? monthlyAllowance(plan),
        consumed: period?.consumed ?? 0,
        purchasedBalance,
        periodStart,
        periodEnd: nextMonthUtc(periodStart),
      };
    },
  };
}

export type CreditService = ReturnType<typeof createCreditService>;
```

- [ ] **Step 4: Acrescentar `workspaceOfRun` ao repositório**

O estorno chega com `agentRunId` e precisa do workspace. Em `src/billing/credit.repository.ts`,
dentro do objeto devolvido por `createCreditRepository`:

```ts
    async workspaceOfRun(agentRunId: string): Promise<string> {
      const run = await prisma.agentRun.findUniqueOrThrow({
        where: { id: agentRunId },
        select: { workspaceId: true },
      });
      return run.workspaceId;
    },
```

E no fake do teste da Task 5 e da Task 6, acrescentar
`workspaceOfRun: vi.fn().mockResolvedValue('ws-1')` ao objeto `repo`.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm vitest run src/billing/`
Expected: PASS — 11 testes de serviço + os das tasks anteriores.

- [ ] **Step 6: Commitar**

```bash
pnpm typecheck && pnpm test
git add src/billing/credit.service.ts src/billing/credit.service.test.ts src/billing/credit.repository.ts
git commit -m "feat(billing): credit service with allowance-first charging and refunds"
```

---

## Task 7: Chave BYOK — repositório e serviço

**Files:**
- Create: `src/billing/provider-key.repository.ts`, `src/billing/provider-key.service.ts`, `src/billing/provider-key.service.test.ts`

**Interfaces:**
- Consumes: `seal`, `open`, `last4` (Task 4), `InvalidProviderKeyError` (Task 3), `AiProvider` de `src/ai/providers/provider.ts`.
- Produces:

```ts
export type ProviderKeyStatus =
  | { configured: false }
  | { configured: true; provider: string; last4: string; createdAt: Date };

export function createProviderKeyRepository(prisma: PrismaClient): ProviderKeyRepository;
export function createProviderKeyService(deps: {
  repo: ProviderKeyRepository;
  verify(provider: string, apiKey: string): Promise<boolean>;
}): ProviderKeyService;
```

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/billing/provider-key.service.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createProviderKeyService } from './provider-key.service.js';
import { InvalidProviderKeyError } from '../lib/errors.js';
import type { ProviderKeyRepository } from './provider-key.repository.js';

function fake(over: Record<string, unknown> = {}) {
  const repo = {
    upsert: vi.fn().mockResolvedValue({ last4: '9876', createdAt: new Date('2026-07-01T00:00:00Z') }),
    find: vi.fn().mockResolvedValue(null),
    remove: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
  const verify = vi.fn().mockResolvedValue(true);
  return { repo, verify, service: createProviderKeyService({ repo: repo as unknown as ProviderKeyRepository, verify }) };
}

describe('providerKeyService', () => {
  it('verifies the key against the provider before storing it', async () => {
    const { service, repo, verify } = fake();

    await service.put({ workspaceId: 'ws-1', provider: 'deepseek', apiKey: 'sk-live-9876', userId: 'u1' });

    expect(verify).toHaveBeenCalledWith('deepseek', 'sk-live-9876');
    expect(repo.upsert).toHaveBeenCalled();
    expect(verify.mock.invocationCallOrder[0]!).toBeLessThan(repo.upsert.mock.invocationCallOrder[0]!);
  });

  it('stores nothing when the provider rejects the key', async () => {
    const { service, repo, verify } = fake();
    verify.mockResolvedValue(false);

    await expect(
      service.put({ workspaceId: 'ws-1', provider: 'deepseek', apiKey: 'bad', userId: 'u1' }),
    ).rejects.toBeInstanceOf(InvalidProviderKeyError);

    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('seals the key and keeps only the last four digits in the clear', async () => {
    const { service, repo } = fake();

    await service.put({ workspaceId: 'ws-1', provider: 'deepseek', apiKey: 'sk-live-9876', userId: 'u1' });

    const stored = repo.upsert.mock.calls[0]![0];
    expect(stored.last4).toBe('9876');
    expect(stored.ciphertext.toString('utf8')).not.toContain('sk-live');
    expect(Object.values(stored).join(' ')).not.toContain('sk-live-9876');
  });

  it('reports no key as configured: false', async () => {
    const { service } = fake();
    expect(await service.status('ws-1', 'deepseek')).toEqual({ configured: false });
  });

  it('reveals the plaintext only through reveal()', async () => {
    const { seal } = await import('./crypto.js');
    const sealed = seal('sk-live-9876');
    const { service } = fake({
      find: vi.fn().mockResolvedValue({ ...sealed, last4: '9876', provider: 'deepseek', createdAt: new Date() }),
    });

    expect(await service.reveal('ws-1', 'deepseek')).toBe('sk-live-9876');
    expect(await service.status('ws-1', 'deepseek')).toMatchObject({ configured: true, last4: '9876' });
  });

  it('tells whether a workspace has a key without decrypting it', async () => {
    const { service, repo } = fake({ find: vi.fn().mockResolvedValue({ last4: '9876' }) });

    expect(await service.has('ws-1', 'deepseek')).toBe(true);
    expect(repo.find).toHaveBeenCalledWith('ws-1', 'deepseek');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/billing/provider-key.service.test.ts`
Expected: FAIL — módulos não existem.

- [ ] **Step 3: Escrever o repositório**

Criar `src/billing/provider-key.repository.ts`:

```ts
import type { PrismaClient } from '@prisma/client';

export type StoredKey = {
  provider: string;
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  last4: string;
  createdAt: Date;
};

export function createProviderKeyRepository(prisma: PrismaClient) {
  return {
    find(workspaceId: string, provider: string): Promise<StoredKey | null> {
      return prisma.workspaceProviderKey.findUnique({
        where: { workspaceId_provider: { workspaceId, provider } },
        select: { provider: true, ciphertext: true, iv: true, authTag: true, last4: true, createdAt: true },
      });
    },

    async upsert(input: StoredKey & { workspaceId: string; createdBy: string }): Promise<{ last4: string; createdAt: Date }> {
      const row = await prisma.workspaceProviderKey.upsert({
        where: { workspaceId_provider: { workspaceId: input.workspaceId, provider: input.provider } },
        create: {
          workspaceId: input.workspaceId,
          provider: input.provider,
          ciphertext: input.ciphertext,
          iv: input.iv,
          authTag: input.authTag,
          last4: input.last4,
          createdBy: input.createdBy,
        },
        update: {
          ciphertext: input.ciphertext,
          iv: input.iv,
          authTag: input.authTag,
          last4: input.last4,
          createdBy: input.createdBy,
        },
        select: { last4: true, createdAt: true },
      });
      return row;
    },

    async remove(workspaceId: string, provider: string): Promise<void> {
      await prisma.workspaceProviderKey.deleteMany({ where: { workspaceId, provider } });
    },
  };
}

export type ProviderKeyRepository = ReturnType<typeof createProviderKeyRepository>;
```

`deleteMany` em vez de `delete` para que apagar chave inexistente seja no-op, não exceção.

- [ ] **Step 4: Escrever o serviço**

Criar `src/billing/provider-key.service.ts`:

```ts
import { last4 as tailOf, open, seal } from './crypto.js';
import { InvalidProviderKeyError } from '../lib/errors.js';
import type { ProviderKeyRepository } from './provider-key.repository.js';

export type ProviderKeyStatus =
  | { configured: false }
  | { configured: true; provider: string; last4: string; createdAt: Date };

export function createProviderKeyService(deps: {
  repo: ProviderKeyRepository;
  verify(provider: string, apiKey: string): Promise<boolean>;
}) {
  const { repo, verify } = deps;

  return {
    // Verificar antes de gravar: chave errada aceita em silêncio só apareceria
    // como run FAILED horas depois, sem pista do porquê.
    async put(input: { workspaceId: string; provider: string; apiKey: string; userId: string }): Promise<ProviderKeyStatus> {
      const ok = await verify(input.provider, input.apiKey);
      if (!ok) throw new InvalidProviderKeyError({ provider: input.provider });

      const sealed = seal(input.apiKey);
      const row = await repo.upsert({
        workspaceId: input.workspaceId,
        provider: input.provider,
        ...sealed,
        last4: tailOf(input.apiKey),
        createdBy: input.userId,
        createdAt: new Date(),
      });

      return { configured: true, provider: input.provider, last4: row.last4, createdAt: row.createdAt };
    },

    async status(workspaceId: string, provider: string): Promise<ProviderKeyStatus> {
      const row = await repo.find(workspaceId, provider);
      if (!row) return { configured: false };
      return { configured: true, provider: row.provider, last4: row.last4, createdAt: row.createdAt };
    },

    async has(workspaceId: string, provider: string): Promise<boolean> {
      return (await repo.find(workspaceId, provider)) !== null;
    },

    // Único caminho que devolve texto claro. Não existe rota que chame isto.
    async reveal(workspaceId: string, provider: string): Promise<string | null> {
      const row = await repo.find(workspaceId, provider);
      if (!row) return null;
      return open({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag });
    },

    remove(workspaceId: string, provider: string): Promise<void> {
      return repo.remove(workspaceId, provider);
    },
  };
}

export type ProviderKeyService = ReturnType<typeof createProviderKeyService>;
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm vitest run src/billing/provider-key.service.test.ts`
Expected: PASS, 6 testes.

- [ ] **Step 6: Commitar**

```bash
pnpm typecheck && pnpm test
git add src/billing/provider-key.repository.ts src/billing/provider-key.service.ts src/billing/provider-key.service.test.ts
git commit -m "feat(billing): BYOK key storage with provider-side verification"
```

---

## Task 8: Policy real e ligação no runner

**Files:**
- Modify: `src/ai/policy.ts`, `src/ai/policy.test.ts`, `src/ai/runner/runner.ts`, `src/ai/runner/runner.harness.ts`, `src/app.ts`
- Create: `src/ai/billing-policy.test.ts`

**Interfaces:**
- Consumes: `CreditService` (Task 6), `ProviderKeyService` (Task 7).
- Produces:

```ts
export type RunAuthorization =
  | { allowed: true }
  | { allowed: false; reason: string; required?: number; available?: number };

export type AiPolicy = {
  authorizeRun(tenant: TenantContext, input: { taskType: string; agentRunId: string; provider: string }): Promise<RunAuthorization>;
  resolveProviderCredentials(tenant: TenantContext, provider: string): Promise<ProviderCredentials>;
  onRunFailed(tenant: TenantContext, agentRunId: string): Promise<void>;
};

export function createBillingPolicy(deps: {
  credits: CreditService;
  keys: ProviderKeyService;
  platformApiKey?: string;
  now?: () => Date;
}): AiPolicy;
```

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/ai/billing-policy.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createBillingPolicy } from './policy.js';
import type { CreditService } from '../billing/credit.service.js';
import type { ProviderKeyService } from '../billing/provider-key.service.js';

const tenant = { userId: 'u1', organizationId: 'o1', workspaceId: 'ws-1', role: 'OWNER' as const };
const run = { taskType: 'summarize-business-context', agentRunId: 'run-1', provider: 'deepseek' };

function fake(over: { byok?: boolean; authorize?: unknown } = {}) {
  const credits = {
    authorizeAndCharge: vi.fn().mockResolvedValue(over.authorize ?? { allowed: true, charge: null }),
    refund: vi.fn().mockResolvedValue(undefined),
  } as unknown as CreditService;
  const keys = {
    has: vi.fn().mockResolvedValue(over.byok ?? false),
    reveal: vi.fn().mockResolvedValue(over.byok ? 'sk-byok-1234' : null),
  } as unknown as ProviderKeyService;
  const policy = createBillingPolicy({ credits, keys, platformApiKey: 'sk-platform', now: () => new Date('2026-07-15T00:00:00Z') });
  return { credits, keys, policy };
}

describe('billing policy', () => {
  it('charges credits for a platform-key run', async () => {
    const { policy, credits } = fake();

    expect(await policy.authorizeRun(tenant, run)).toEqual({ allowed: true });
    expect(credits.authorizeAndCharge).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', agentRunId: 'run-1', byok: false }),
    );
  });

  it('passes byok through so the workspace is not charged', async () => {
    const { policy, credits } = fake({ byok: true });

    await policy.authorizeRun(tenant, run);

    expect(credits.authorizeAndCharge).toHaveBeenCalledWith(expect.objectContaining({ byok: true }));
  });

  it('surfaces the shortfall numbers when blocked', async () => {
    const { policy } = fake({ authorize: { allowed: false, required: 9, available: 2 } });

    const result = await policy.authorizeRun(tenant, run);

    expect(result).toMatchObject({ allowed: false, required: 9, available: 2 });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toMatch(/credit/i);
  });

  it('prefers the workspace key over the platform key', async () => {
    const { policy } = fake({ byok: true });

    expect(await policy.resolveProviderCredentials(tenant, 'deepseek')).toEqual({
      apiKey: 'sk-byok-1234',
      source: 'BYOK',
    });
  });

  it('falls back to the platform key', async () => {
    const { policy } = fake();

    expect(await policy.resolveProviderCredentials(tenant, 'deepseek')).toEqual({
      apiKey: 'sk-platform',
      source: 'PLATFORM',
    });
  });

  it('refunds on failure', async () => {
    const { policy, credits } = fake();

    await policy.onRunFailed(tenant, 'run-1');

    expect(credits.refund).toHaveBeenCalledWith({ agentRunId: 'run-1', now: new Date('2026-07-15T00:00:00Z') });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/ai/billing-policy.test.ts`
Expected: FAIL — `createBillingPolicy` não existe.

- [ ] **Step 3: Reescrever `src/ai/policy.ts`**

Manter `ProviderCredentials`, `MissingProviderKeyError` e `createDefaultPolicy` (os testes
do B1 e o harness dependem deles), alargar `RunAuthorization` e `AiPolicy`, e acrescentar
a fábrica nova:

```ts
export type RunAuthorization =
  | { allowed: true }
  | { allowed: false; reason: string; required?: number; available?: number };

export type AiPolicy = {
  authorizeRun(
    tenant: TenantContext,
    input: { taskType: string; agentRunId: string; provider: string },
  ): Promise<RunAuthorization>;
  resolveProviderCredentials(tenant: TenantContext, provider: string): Promise<ProviderCredentials>;
  onRunFailed(tenant: TenantContext, agentRunId: string): Promise<void>;
};

// A policy é o adaptador: traduz o contexto do runner em operação de billing.
// O runner continua sem saber que crédito existe.
export function createBillingPolicy(deps: {
  credits: CreditService;
  keys: ProviderKeyService;
  platformApiKey?: string;
  now?: () => Date;
}): AiPolicy {
  const now = deps.now ?? (() => new Date());

  return {
    async authorizeRun(tenant, input) {
      const byok = await deps.keys.has(tenant.workspaceId, input.provider);

      const result = await deps.credits.authorizeAndCharge({
        workspaceId: tenant.workspaceId,
        taskType: input.taskType,
        agentRunId: input.agentRunId,
        byok,
        now: now(),
      });

      if (result.allowed) return { allowed: true };
      return {
        allowed: false,
        reason: `insufficient credits: needs ${result.required}, has ${result.available}`,
        required: result.required,
        available: result.available,
      };
    },

    async resolveProviderCredentials(tenant, provider) {
      const byok = await deps.keys.reveal(tenant.workspaceId, provider);
      if (byok) return { apiKey: byok, source: 'BYOK' };

      if (!deps.platformApiKey) throw new MissingProviderKeyError();
      return { apiKey: deps.platformApiKey, source: 'PLATFORM' };
    },

    async onRunFailed(_tenant, agentRunId) {
      await deps.credits.refund({ agentRunId, now: now() });
    },
  };
}
```

Em `createDefaultPolicy`, acrescentar `onRunFailed: async () => {}` para que o tipo feche.

- [ ] **Step 4: Ligar no runner**

Em `src/ai/runner/runner.ts`, três mudanças e nada mais.

A chamada de autorização passa a levar run e provider:

```ts
  const authorization = await deps.policy.authorizeRun(tenant, {
    taskType: run.taskType,
    agentRunId,
    provider: entry.provider,
  });
```

O `fail` avisa a policy — o estorno é no-op quando não houve débito, então bloqueio por
saldo não gera lançamento nenhum:

```ts
  const fail = async (error: string) => {
    await deps.repo.markFailed(agentRunId, {
      error,
      model: entry.modelId,
      provider: entry.provider,
      tier,
      ...totalUsage(),
      estimatedCost: totalCost(),
      modelCalls,
    });
    await deps.policy.onRunFailed(tenant, agentRunId);
  };
```

`fail` hoje é chamado antes de `tenant` existir (task type desconhecido, input inválido).
Mover a resolução de `resolveTenant` para **antes** do primeiro `fail`, logo depois do
`if (run.status === ...) return;`. É a única reordenação necessária.

- [ ] **Step 5: Atualizar o harness e os testes do B1**

Em `src/ai/runner/runner.harness.ts`, a policy falsa ganha o método novo:

```ts
    policy: {
      ...defaultPolicy,
      authorizeRun: async () => ({ allowed: true }),
      resolveProviderCredentials: async () => ({ apiKey: 'k', source: 'PLATFORM' }),
      onRunFailed: async () => {},
    },
```

Em `src/ai/policy.test.ts`, ajustar as chamadas de `authorizeRun` para a assinatura nova.

- [ ] **Step 6: Ligar no `app.ts`**

Onde o worker é criado, trocar `defaultPolicy` pela policy real:

```ts
    const credits = createCreditService({ repo: createCreditRepository(app.prisma) });
    const keys = createProviderKeyService({
      repo: createProviderKeyRepository(app.prisma),
      verify: verifyProviderKey,
    });

    const worker = startAgentRunWorker({
      prisma: app.prisma,
      repo: createAgentRunRepository(app.prisma),
      policy: createBillingPolicy({ credits, keys, platformApiKey: env.AI_PROVIDER_API_KEY }),
      createProvider: (_name, credentials) => createDeepSeekProvider(credentials.apiKey),
      logger: app.log,
    });
```

`verifyProviderKey` é criada na Task 10, junto da rota que precisa dela. Até lá, importar
de `src/billing/verify-provider-key.js` deixaria a Task 8 vermelha — então nesta task
passe `verify: async () => true` **com um TODO explícito no commit**, e a Task 10 troca
pela implementação real. (Nenhuma rota de gravação existe antes da Task 10, então nada
grava chave sem verificação nesse intervalo.)

- [ ] **Step 7: Provar no runner que o bloqueio não gasta token**

O teste de policy prova a tradução; este prova a consequência. Acrescentar a
`src/ai/runner/runner.test.ts`:

```ts
  it('never calls the provider when the run is not authorized', async () => {
    const { deps, repo, provider } = harness([]);
    deps.policy = {
      ...deps.policy,
      authorizeRun: async () => ({ allowed: false, reason: 'insufficient credits: needs 1, has 0', required: 1, available: 0 }),
    };

    await executeAgentRun(deps, 'run-1');

    expect(provider.requests).toHaveLength(0);
    expect(repo.markFailed.mock.calls[0]![1].error).toMatch(/insufficient credits/i);
    expect(repo.markFailed.mock.calls[0]![1].modelCalls).toBe(0);
  });

  it('tells the policy when a run fails, so the charge can be refunded', async () => {
    const onRunFailed = vi.fn().mockResolvedValue(undefined);
    const { deps } = harness([]);
    deps.policy = { ...deps.policy, onRunFailed, authorizeRun: async () => ({ allowed: true }) };
    deps.repo.findById.mockResolvedValue({
      id: 'run-1', workspaceId: 'ws-1', taskType: 'ghost-task', agentType: 'x',
      tier: 'TIER1', status: 'PENDING', modelCalls: 0, input: {}, requestedBy: 'u1',
    });

    await executeAgentRun(deps, 'run-1');

    expect(onRunFailed).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws-1' }), 'run-1');
  });
```

O segundo caso usa um `taskType` desconhecido de propósito: é o caminho de falha mais
curto, e é justamente o que exige que `resolveTenant` tenha rodado antes do primeiro
`fail` (Step 4).

- [ ] **Step 8: Rodar e ver passar**

Run: `pnpm vitest run src/ai/`
Expected: PASS — 6 de policy + 2 de runner + os do B1 ajustados.

- [ ] **Step 9: Commitar**

```bash
pnpm typecheck && pnpm test
git add src/ai src/app.ts
git commit -m "feat(ai): charge credits and resolve BYOK keys through the run policy"
```

---

## Task 9: `GET /credits`, `/credits/ledger` e `/credits/pricing`

**Files:**
- Create: `src/http/api/credits/credits.schema.ts`, `src/http/api/credits/credits.presenter.ts`, `src/http/api/credits/get-credits/get-credits.controller.ts`, `src/http/api/credits/list-ledger/list-ledger.controller.ts`, `src/http/api/credits/get-pricing/get-pricing.controller.ts`, `src/http/api/credits/index.ts`, `src/http/api/credits/credits.test.ts`
- Modify: `src/app.ts`, `src/billing/operation-cost.ts`

**Interfaces:**
- Consumes: `createCreditService`, `createCreditRepository`, `creditCost` (Task 2).
- Produces: rotas `getCredits`, `listCreditLedger`, `getCreditPricing`; `operationCatalog(): { taskType: string; credits: number }[]`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/http/api/credits/credits.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { getCreditsRoute } from './get-credits/get-credits.controller.js';
import { listLedgerRoute } from './list-ledger/list-ledger.controller.js';

const PERIOD = new Date('2026-07-01T00:00:00Z');

function prismaFake() {
  return {
    workspace: { findUniqueOrThrow: vi.fn().mockResolvedValue({ plan: 'STARTER' }) },
    creditPeriod: { findUnique: vi.fn().mockResolvedValue({ id: 'p-1', periodStart: PERIOD, allowance: 200, consumed: 12 }) },
    creditLedger: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'l-1', kind: 'DEBIT', credits: -1, agentRunId: 'run-1', reason: 'agent run run-1', createdAt: new Date('2026-07-10T00:00:00Z') },
      ]),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ balance: 30 }]),
  };
}

async function buildTestApp(role: 'OWNER' | 'VIEWER' = 'OWNER') {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prismaFake() as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'o1', workspaceId: 'ws-1', role };
  });
  await app.register(getCreditsRoute);
  await app.register(listLedgerRoute);
  return app;
}

describe('credits routes', () => {
  it('reports plan, allowance and purchased balance', async () => {
    const app = await buildTestApp();

    const res = await app.inject({ method: 'GET', url: '/credits' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      plan: 'STARTER', allowance: 200, consumed: 12, purchasedBalance: 30,
    });
  });

  it('lets a VIEWER read the balance', async () => {
    const app = await buildTestApp('VIEWER');
    expect((await app.inject({ method: 'GET', url: '/credits' })).statusCode).toBe(200);
  });

  it('returns the ledger newest first', async () => {
    const app = await buildTestApp();

    const res = await app.inject({ method: 'GET', url: '/credits/ledger' });

    expect(res.statusCode).toBe(200);
    expect(res.json().entries[0]).toMatchObject({ kind: 'DEBIT', credits: -1 });
  });

  it('rejects a bad cursor', async () => {
    const app = await buildTestApp();
    expect((await app.inject({ method: 'GET', url: '/credits/ledger?before=notadate' })).statusCode).toBe(400);
  });

  it('publishes what each action costs in credits', async () => {
    const app = await buildTestApp();

    const res = await app.inject({ method: 'GET', url: '/credits/pricing' });

    expect(res.statusCode).toBe(200);
    expect(res.json().operations).toContainEqual({ taskType: 'summarize-business-context', credits: 1 });
  });

  it('never leaks money or tokens to the client', async () => {
    const app = await buildTestApp();

    for (const url of ['/credits', '/credits/ledger', '/credits/pricing']) {
      const payload = (await app.inject({ method: 'GET', url })).payload;
      expect(payload).not.toMatch(/estimatedCost|inputTokens|outputTokens|pricePerMTok/);
    }
  });
});
```

O último teste é o contrato do §3 do spec: crédito é a unidade do cliente, dinheiro e
token são auditoria interna e não saem em resposta de billing.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/http/api/credits/`
Expected: FAIL — controllers não existem.

- [ ] **Step 3: Escrever schema e presenter**

`src/http/api/credits/credits.schema.ts`:

```ts
import { z } from 'zod';

export const creditsResponse = z.object({
  plan: z.enum(['STARTER', 'GROWTH', 'SCALE']),
  allowance: z.number().int(),
  consumed: z.number().int(),
  purchasedBalance: z.number().int(),
  periodStart: z.string(),
  periodEnd: z.string(),
});

export const ledgerQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  before: z.coerce.date().optional(),
});

export const pricingResponse = z.object({
  operations: z.array(z.object({ taskType: z.string(), credits: z.number().int() })),
});

export const ledgerResponse = z.object({
  entries: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['DEBIT', 'REFUND', 'PURCHASE', 'GRANT']),
      credits: z.number().int(),
      agentRunId: z.string().nullable(),
      reason: z.string(),
      createdAt: z.string(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
```

`src/http/api/credits/credits.presenter.ts`:

```ts
import type { CreditSummary } from '../../../billing/credit.service.js';
import type { LedgerRow } from '../../../billing/credit.repository.js';

export function presentCredits(summary: CreditSummary) {
  return {
    plan: summary.plan,
    allowance: summary.allowance,
    consumed: summary.consumed,
    purchasedBalance: summary.purchasedBalance,
    periodStart: summary.periodStart.toISOString(),
    periodEnd: summary.periodEnd.toISOString(),
  };
}

export function presentLedger(rows: LedgerRow[]) {
  return {
    entries: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      credits: row.credits,
      agentRunId: row.agentRunId,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    })),
    // Cursor é o createdAt do último item: a próxima página pede `before` com ele.
    nextCursor: rows.length ? rows[rows.length - 1]!.createdAt.toISOString() : null,
  };
}
```

- [ ] **Step 4: Escrever os controllers e o index**

`get-credits/get-credits.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createCreditRepository } from '../../../../billing/credit.repository.js';
import { createCreditService } from '../../../../billing/credit.service.js';
import { creditsResponse } from '../credits.schema.js';
import { presentCredits } from '../credits.presenter.js';

export const getCreditsRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/credits',
    { schema: { tags: ['credits'], operationId: 'getCredits', response: { 200: creditsResponse } } },
    async (req, reply) => {
      // Leitura de saldo é para qualquer membro, inclusive VIEWER: saber quanto
      // resta não é escrita.
      const service = createCreditService({ repo: createCreditRepository(app.prisma) });
      return reply.send(presentCredits(await service.summary(req.tenant.workspaceId, new Date())));
    },
  );
};
```

`list-ledger/list-ledger.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createCreditRepository } from '../../../../billing/credit.repository.js';
import { ledgerQuery, ledgerResponse } from '../credits.schema.js';
import { presentLedger } from '../credits.presenter.js';

export const listLedgerRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/credits/ledger',
    {
      schema: {
        tags: ['credits'],
        operationId: 'listCreditLedger',
        querystring: ledgerQuery,
        response: { 200: ledgerResponse },
      },
    },
    async (req, reply) => {
      const repo = createCreditRepository(app.prisma);
      const rows = await repo.listLedger(req.tenant.workspaceId, req.query.limit, req.query.before);
      return reply.send(presentLedger(rows));
    },
  );
};
```

`get-pricing/get-pricing.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { operationCatalog } from '../../../../billing/operation-cost.js';
import { pricingResponse } from '../credits.schema.js';

export const getPricingRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/credits/pricing',
    { schema: { tags: ['credits'], operationId: 'getCreditPricing', response: { 200: pricingResponse } } },
    async (_req, reply) => {
      // Só créditos. Preço de modelo e token são auditoria interna e não saem daqui.
      return reply.send({ operations: operationCatalog() });
    },
  );
};
```

Em `src/billing/operation-cost.ts`, expor o catálogo:

```ts
export function operationCatalog(): { taskType: string; credits: number }[] {
  return Object.entries(CREDITS_BY_TASK).map(([taskType, credits]) => ({ taskType, credits }));
}
```

`index.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import { getCreditsRoute } from './get-credits/get-credits.controller.js';
import { listLedgerRoute } from './list-ledger/list-ledger.controller.js';
import { getPricingRoute } from './get-pricing/get-pricing.controller.js';

/** Registers all `credits` routes. Auth + tenant resolution applied at this scope. */
export const creditsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.resolveTenant);

  await app.register(getCreditsRoute);
  await app.register(listLedgerRoute);
  await app.register(getPricingRoute);
};
```

Registrar em `src/app.ts`: `await app.register(creditsRoutes);`. No teste, registrar
também `getPricingRoute` no `buildTestApp`.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm vitest run src/http/api/credits/`
Expected: PASS, 6 testes.

- [ ] **Step 6: Commitar**

```bash
pnpm typecheck && pnpm test
git add src/http/api/credits src/app.ts
git commit -m "feat(api): credit balance and ledger endpoints"
```

---

## Task 10: Rotas da chave BYOK

**Files:**
- Create: `src/billing/verify-provider-key.ts`, `src/http/api/provider-key/provider-key.schema.ts`, `src/http/api/provider-key/provider-key.controller.ts`, `src/http/api/provider-key/index.ts`, `src/http/api/provider-key/provider-key.test.ts`
- Modify: `src/app.ts`, `src/lib/tenant.ts`

**Interfaces:**
- Consumes: `createProviderKeyService` (Task 7), `getModelForTier` (B1), `createDeepSeekProvider` (B1).
- Produces: `assertAdmin(tenant)`, `verifyProviderKey(provider, apiKey)`, rotas `getProviderKey`, `putProviderKey`, `deleteProviderKey`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/http/api/provider-key/provider-key.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { providerKeyRoutes } from './index.js';
import errorHandlerPlugin from '../../../plugins/error-handler.js';

vi.mock('../../../billing/verify-provider-key.js', () => ({
  verifyProviderKey: vi.fn(async (_provider: string, apiKey: string) => apiKey.startsWith('sk-good')),
}));

function prismaFake(existing: unknown = null) {
  return {
    workspaceProviderKey: {
      findUnique: vi.fn().mockResolvedValue(existing),
      upsert: vi.fn().mockResolvedValue({ last4: '9876', createdAt: new Date('2026-07-01T00:00:00Z') }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

async function buildTestApp(role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER', existing: unknown = null) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', prismaFake(existing) as never);
  app.decorate('authenticate', async () => {});
  app.decorate('resolveTenant', async () => {});
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'o1', workspaceId: 'ws-1', role };
  });
  await app.register(providerKeyRoutes);
  return app;
}

describe('provider key routes', () => {
  it('reports no key', async () => {
    const app = await buildTestApp('OWNER');
    const res = await app.inject({ method: 'GET', url: '/ai/provider-key' });
    expect(res.json()).toEqual({ configured: false });
  });

  it('stores a verified key and answers with last4 only', async () => {
    const app = await buildTestApp('ADMIN');

    const res = await app.inject({
      method: 'PUT', url: '/ai/provider-key',
      payload: { provider: 'deepseek', apiKey: 'sk-good-9876' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ configured: true, last4: '9876' });
    expect(res.payload).not.toContain('sk-good-9876');
  });

  it('rejects a key the provider refuses', async () => {
    const app = await buildTestApp('OWNER');

    const res = await app.inject({
      method: 'PUT', url: '/ai/provider-key',
      payload: { provider: 'deepseek', apiKey: 'sk-bad-0000' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('AUR-T0014');
  });

  it('denies MEMBER and VIEWER', async () => {
    for (const role of ['MEMBER', 'VIEWER'] as const) {
      const app = await buildTestApp(role);
      expect((await app.inject({ method: 'GET', url: '/ai/provider-key' })).statusCode).toBe(403);
      expect(
        (await app.inject({ method: 'PUT', url: '/ai/provider-key', payload: { provider: 'deepseek', apiKey: 'sk-good-1' } })).statusCode,
      ).toBe(403);
    }
  });

  it('deletes with 204', async () => {
    const app = await buildTestApp('OWNER');
    expect((await app.inject({ method: 'DELETE', url: '/ai/provider-key?provider=deepseek' })).statusCode).toBe(204);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/http/api/provider-key/`
Expected: FAIL — módulos não existem.

- [ ] **Step 3: Acrescentar `assertAdmin`**

Em `src/lib/tenant.ts`:

```ts
// Configuração sensível do workspace (chave de provider, integrações) é de
// OWNER/ADMIN. MEMBER escreve conteúdo, não credencial.
export function assertAdmin(tenant: TenantContext): void {
  if (tenant.role !== 'OWNER' && tenant.role !== 'ADMIN') {
    throw new ForbiddenError('Only workspace owners and admins can manage provider keys');
  }
}
```

- [ ] **Step 4: Escrever o verificador de chave**

Criar `src/billing/verify-provider-key.ts`:

```ts
import { getModelForTier } from '../ai/model-router/router.js';
import { createDeepSeekProvider } from '../ai/providers/openai-compatible.js';

// Uma completion mínima contra o provider real. Barata (1 token de saída) e rara
// (só na gravação), e evita guardar uma chave que só falharia horas depois.
export async function verifyProviderKey(provider: string, apiKey: string): Promise<boolean> {
  if (provider !== 'deepseek') return false;

  try {
    await createDeepSeekProvider(apiKey).complete({
      modelId: getModelForTier('TIER1').modelId,
      messages: [{ role: 'user', content: 'ping' }],
      jsonMode: false,
      maxTokens: 1,
      signal: AbortSignal.timeout(10_000),
    });
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Escrever schema, controller e index**

`provider-key.schema.ts`:

```ts
import { z } from 'zod';

export const putProviderKeyBody = z.object({
  provider: z.literal('deepseek'),
  apiKey: z.string().min(8),
});

export const providerKeyQuery = z.object({ provider: z.literal('deepseek').default('deepseek') });

export const providerKeyResponse = z.union([
  z.object({ configured: z.literal(false) }),
  z.object({
    configured: z.literal(true),
    provider: z.string(),
    last4: z.string(),
    createdAt: z.string(),
  }),
]);
```

`provider-key.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createProviderKeyRepository } from '../../../billing/provider-key.repository.js';
import { createProviderKeyService } from '../../../billing/provider-key.service.js';
import { verifyProviderKey } from '../../../billing/verify-provider-key.js';
import { assertAdmin } from '../../../lib/tenant.js';
import { providerKeyQuery, providerKeyResponse, putProviderKeyBody } from './provider-key.schema.js';
import type { ProviderKeyStatus } from '../../../billing/provider-key.service.js';

function present(status: ProviderKeyStatus) {
  if (!status.configured) return { configured: false as const };
  return {
    configured: true as const,
    provider: status.provider,
    last4: status.last4,
    createdAt: status.createdAt.toISOString(),
  };
}

export const providerKeyController: FastifyPluginAsync = async (app) => {
  const service = () =>
    createProviderKeyService({
      repo: createProviderKeyRepository(app.prisma),
      verify: verifyProviderKey,
    });

  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/ai/provider-key',
    {
      schema: {
        tags: ['provider-key'],
        operationId: 'getProviderKey',
        querystring: providerKeyQuery,
        response: { 200: providerKeyResponse },
      },
    },
    async (req, reply) => {
      assertAdmin(req.tenant);
      return reply.send(present(await service().status(req.tenant.workspaceId, req.query.provider)));
    },
  );

  typed.put(
    '/ai/provider-key',
    {
      schema: {
        tags: ['provider-key'],
        operationId: 'putProviderKey',
        body: putProviderKeyBody,
        response: { 200: providerKeyResponse },
      },
    },
    async (req, reply) => {
      assertAdmin(req.tenant);
      const status = await service().put({
        workspaceId: req.tenant.workspaceId,
        provider: req.body.provider,
        apiKey: req.body.apiKey,
        userId: req.tenant.userId,
      });
      return reply.send(present(status));
    },
  );

  typed.delete(
    '/ai/provider-key',
    {
      schema: {
        tags: ['provider-key'],
        operationId: 'deleteProviderKey',
        querystring: providerKeyQuery,
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      assertAdmin(req.tenant);
      await service().remove(req.tenant.workspaceId, req.query.provider);
      return reply.code(204).send();
    },
  );
};
```

Acrescentar `import { z } from 'zod';` no topo do controller (usado no `204`).

`index.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import { providerKeyController } from './provider-key.controller.js';

/** Registers the BYOK provider-key routes. Auth + tenant resolution at this scope. */
export const providerKeyRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.resolveTenant);

  await app.register(providerKeyController);
};
```

Registrar em `src/app.ts`: `await app.register(providerKeyRoutes);`, e trocar o
`verify: async () => true` provisório da Task 8 por `verify: verifyProviderKey`.

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm vitest run src/http/api/provider-key/`
Expected: PASS, 5 testes.

- [ ] **Step 7: Commitar**

```bash
pnpm typecheck && pnpm test
git add src/http/api/provider-key src/billing/verify-provider-key.ts src/lib/tenant.ts src/app.ts
git commit -m "feat(api): BYOK provider key endpoints for workspace admins"
```

---

## Task 11: CLI de concessão de crédito

**Files:**
- Create: `src/scripts/grant-credits.ts`, `src/scripts/grant-credits.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `createCreditService`, `createCreditRepository`.
- Produces: `parseGrantArgs(argv: string[])`, script `pnpm ai:grant`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/scripts/grant-credits.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseGrantArgs } from './grant-credits.js';

describe('parseGrantArgs', () => {
  it('parses a full invocation', () => {
    expect(
      parseGrantArgs(['--workspace', 'ws-1', '--credits', '500', '--reason', 'support credit']),
    ).toEqual({ workspaceId: 'ws-1', credits: 500, reason: 'support credit' });
  });

  it('refuses a non-positive amount', () => {
    expect(() => parseGrantArgs(['--workspace', 'ws-1', '--credits', '0', '--reason', 'x'])).toThrow();
  });

  it('demands a reason, because the ledger is the audit trail', () => {
    expect(() => parseGrantArgs(['--workspace', 'ws-1', '--credits', '10'])).toThrow(/reason/i);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/scripts/grant-credits.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Criar `src/scripts/grant-credits.ts`:

```ts
import { PrismaClient } from '@prisma/client';
import { createCreditRepository } from '../billing/credit.repository.js';
import { createCreditService } from '../billing/credit.service.js';

export type GrantArgs = { workspaceId: string; credits: number; reason: string };

function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

export function parseGrantArgs(argv: string[]): GrantArgs {
  const workspaceId = flag(argv, 'workspace');
  const credits = Number(flag(argv, 'credits'));
  const reason = flag(argv, 'reason');

  if (!workspaceId) throw new Error('--workspace is required');
  if (!Number.isInteger(credits) || credits <= 0) throw new Error('--credits must be a positive integer');
  // Sem motivo, o extrato deixa de explicar de onde veio o crédito — e ele é o
  // único registro de auditoria que existe.
  if (!reason) throw new Error('--reason is required');

  return { workspaceId, credits, reason };
}

if (process.argv[1]?.endsWith('grant-credits.ts')) {
  const args = parseGrantArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  const service = createCreditService({ repo: createCreditRepository(prisma) });

  service
    .grant(args)
    .then(async () => {
      console.log(`granted ${args.credits} credits to ${args.workspaceId}`);
      await prisma.$disconnect();
    })
    .catch(async (error: unknown) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
```

Em `package.json`:

```json
    "ai:grant": "tsx --env-file-if-exists=.env src/scripts/grant-credits.ts",
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/scripts/grant-credits.test.ts`
Expected: PASS, 3 testes.

- [ ] **Step 5: Commitar**

```bash
pnpm typecheck && pnpm test
git add src/scripts/grant-credits.ts src/scripts/grant-credits.test.ts package.json
git commit -m "feat(billing): CLI to grant credits into the ledger"
```

---

## Task 12: Teste de integração da corrida

**Files:**
- Create: `vitest.integration.config.ts`, `src/billing/credit.integration.test.ts`
- Modify: `package.json`, `vitest.config.ts`

**Interfaces:**
- Consumes: tudo do billing.
- Produces: `pnpm test:integration`.

- [ ] **Step 1: Separar as suítes**

Em `vitest.config.ts`, excluir a suíte de integração da suíte padrão:

```ts
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
```

Criar `vitest.integration.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

// Suíte que exige Postgres real (pnpm infra:up). Fora do `pnpm test` porque CI
// não tem banco — e porque o que ela prova, corrida de transação, nenhum fake prova.
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    fileParallelism: false,
    env: {
      JWT_ACCESS_SECRET: 'test-secret-at-least-16-chars',
      AI_KEY_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
    },
  },
});
```

Em `package.json`:

```json
    "test:integration": "vitest run --config vitest.integration.config.ts",
```

- [ ] **Step 2: Escrever o teste que falha**

Criar `src/billing/credit.integration.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createCreditRepository } from './credit.repository.js';
import { createCreditService } from './credit.service.js';

const prisma = new PrismaClient();
const service = createCreditService({ repo: createCreditRepository(prisma) });

const NOW = new Date('2026-07-15T10:00:00Z');
const PERIOD = new Date('2026-07-01T00:00:00Z');

let workspaceId = '';
let runA = '';
let runB = '';

beforeEach(async () => {
  const org = await prisma.organization.create({ data: { name: 'Billing IT', slug: `it-${Date.now()}` } });
  const workspace = await prisma.workspace.create({
    data: { organizationId: org.id, name: 'IT', slug: `it-${Date.now()}`, plan: 'STARTER' },
  });
  workspaceId = workspace.id;

  // Período com exatamente um crédito sobrando: é o cenário que expõe a corrida.
  await prisma.creditPeriod.create({
    data: { workspaceId, periodStart: PERIOD, allowance: 1, consumed: 0 },
  });

  const mkRun = (hash: string) =>
    prisma.agentRun.create({
      data: {
        workspaceId, agentType: 'context-analyst', taskType: 'summarize-business-context',
        tier: 'TIER1', status: 'PENDING', inputHash: hash, input: {},
      },
    });

  runA = (await mkRun('a')).id;
  runB = (await mkRun('b')).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('credit concurrency', () => {
  it('charges exactly one of two simultaneous runs when one credit is left', async () => {
    const [a, b] = await Promise.all([
      service.authorizeAndCharge({ workspaceId, taskType: 'summarize-business-context', agentRunId: runA, byok: false, now: NOW }),
      service.authorizeAndCharge({ workspaceId, taskType: 'summarize-business-context', agentRunId: runB, byok: false, now: NOW }),
    ]);

    expect([a!.allowed, b!.allowed].filter(Boolean)).toHaveLength(1);

    const debits = await prisma.creditLedger.count({ where: { workspaceId, kind: 'DEBIT' } });
    expect(debits).toBe(1);

    const period = await prisma.creditPeriod.findFirstOrThrow({ where: { workspaceId } });
    expect(period.consumed).toBe(1);
  });

  it('opens the month exactly once under concurrency', async () => {
    await prisma.creditPeriod.deleteMany({ where: { workspaceId } });

    await Promise.all([
      service.authorizeAndCharge({ workspaceId, taskType: 'summarize-business-context', agentRunId: runA, byok: false, now: NOW }),
      service.authorizeAndCharge({ workspaceId, taskType: 'summarize-business-context', agentRunId: runB, byok: false, now: NOW }),
    ]);

    expect(await prisma.creditPeriod.count({ where: { workspaceId } })).toBe(1);
  });

  it('refunds a failed run back into the allowance, and only once', async () => {
    await service.authorizeAndCharge({ workspaceId, taskType: 'summarize-business-context', agentRunId: runA, byok: false, now: NOW });

    await service.refund({ agentRunId: runA, now: NOW });
    await service.refund({ agentRunId: runA, now: NOW });

    const period = await prisma.creditPeriod.findFirstOrThrow({ where: { workspaceId } });
    expect(period.consumed).toBe(0);
    expect(await prisma.creditLedger.count({ where: { agentRunId: runA, kind: 'REFUND' } })).toBe(1);
  });
});
```

- [ ] **Step 3: Rodar contra Postgres real**

```bash
pnpm infra:up
pnpm prisma migrate deploy
pnpm test:integration
```

Expected: PASS, 3 testes. Se a corrida falhar (dois `DEBIT`), o problema está no
`lockPeriod` da Task 5 — o `FOR UPDATE` não está pegando a linha certa.

- [ ] **Step 4: Confirmar que a suíte padrão não regrediu**

Run: `pnpm test`
Expected: PASS, e **nenhum** arquivo `*.integration.test.ts` na lista.

- [ ] **Step 5: Commitar**

```bash
pnpm typecheck
git add vitest.config.ts vitest.integration.config.ts package.json src/billing/credit.integration.test.ts
git commit -m "test(billing): prove the debit race and refund idempotency against Postgres"
```

---

## Task 13: Verificação final, contrato e documentação

**Files:**
- Modify: `docs/architecture/ai-architecture.md`, `docs/development/ai-layer-smoke.md`, `.env.example`, `api.json` (no repo `aurea/web`)

**Interfaces:**
- Consumes: tudo.
- Produces: contrato OpenAPI com as seis rotas novas; documentação do estado.

- [ ] **Step 1: Suíte inteira**

```bash
pnpm typecheck
pnpm test
pnpm test:integration     # exige pnpm infra:up
```

Expected: tudo verde.

- [ ] **Step 2: Regerar o OpenAPI**

```bash
pnpm openapi:dump
cd ../web && git diff --stat api.json
```

Expected: `api.json` (que é gerado dentro de `aurea/web`) ganha `/credits`,
`/credits/ledger`, `/credits/pricing` e `/ai/provider-key` com os seis `operationId`.

- [ ] **Step 3: Conferir que nada de segredo vaza**

```bash
grep -riE "apiKey|ciphertext|authTag" ../web/api.json && echo "VAZOU" || echo "ok"
grep -rn "AI_KEY_ENCRYPTION_KEY" src --include=*.ts | grep -v "config/env.ts" | grep -v "billing/crypto.ts"
```

Expected: o primeiro imprime `ok` (o corpo do `PUT` tem `apiKey`, então se aparecer,
conferir que é **só** o request body, nunca uma resposta); o segundo não retorna linha.

- [ ] **Step 4: Smoke do bloqueio**

Com a stack de pé, zerar a franquia de um workspace de teste e disparar um run:

```bash
docker exec back-postgres-1 psql -U aurea -d aurea -c \
  "UPDATE \"CreditPeriod\" SET consumed = allowance WHERE \"workspaceId\" = '<ws>';"
```

Depois criar um `POST /agent-runs` e conferir em `GET /agent-runs/:id`: `status: FAILED`,
`error` mencionando créditos, `modelCalls: 0` — o modelo **não** foi chamado. Em seguida
`pnpm ai:grant --workspace <ws> --credits 10 --reason "smoke"` e repetir: agora completa.

Registrar o resultado no relatório da task. Se não der para rodar, dizer isso — não marcar
como feito.

- [ ] **Step 5: Atualizar a documentação**

Em `docs/architecture/ai-architecture.md`, substituir a nota de estado do B1 por:

```markdown
> **Estado (2026-07-27):** núcleo de execução (B1) e controle de consumo (B2a) existem —
> abstração de provider, Model Router, guardrails, loop de ferramentas, fila, `AgentRun`,
> ledger de créditos com bloqueio e estorno, e BYOK cifrada por workspace. Ainda não
> existem: Stripe com assinatura, cupom e compra de crédito (B2b), e avaliação de
> qualidade (§13).
```

Em `docs/development/ai-layer-smoke.md`, acrescentar à tabela de falhas conhecidas:

```markdown
| `FAILED` com `insufficient credits` | franquia do mês e saldo comprado zerados; ver `GET /credits` |
```

E em `.env.example`, conferir que `AI_KEY_ENCRYPTION_KEY` está documentada (Task 4).

- [ ] **Step 6: Commitar**

```bash
git add docs .env.example
git commit -m "docs(billing): B2a implementation status and credit smoke notes"
cd ../web && git add api.json && git commit -m "chore(api): regenerate OpenAPI with credit and provider-key endpoints"
```

- [ ] **Step 7: Registrar a pendência cross-repo**

No relatório final: `aurea/web` precisa de `pnpm api:generate` para consumir
`getCredits`, `listCreditLedger`, `getCreditPricing`, `getProviderKey`, `putProviderKey` e
`deleteProviderKey`.
O B2a não mexe no frontend.

---

## Notas de sequenciamento

- Tasks 1–4 são independentes entre si depois da migration da Task 1 e podem ser
  paralelizadas: catálogo, custo, erros e cifra não se tocam.
- Task 5 depende da 1; Task 6 depende da 5, 1 e 2; Task 7 depende da 4 e 3.
- Task 8 é o ponto de junção (6 + 7) e é a única que toca o runner — não paralelizar com
  nada que mexa em `src/ai/`.
- Tasks 9, 10 e 11 dependem da 8 apenas por coerência de tipos; entre si são disjuntas.
- Task 12 exige Postgres local e é a única que prova a corrida. Se ela falhar, o defeito
  está na Task 5, não nela.
- O `verify: async () => true` provisório da Task 8 **tem** que sair na Task 10. Se a
  execução parar entre as duas, não existe rota de gravação de chave ainda — mas o débito
  provisório fica registrado aqui para não virar dívida esquecida.

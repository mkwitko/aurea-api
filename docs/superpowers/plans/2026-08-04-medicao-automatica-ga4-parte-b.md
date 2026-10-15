# Medição automática (GA4) — Parte B: leitura, proveniência e telas

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar a medição automática: ler a métrica do experimento pelo conector GA4 sob demanda, gravar o número com proveniência só depois de o humano confirmar, e entregar as três telas (conexão, amarração com assistência de IA, proposta de medição).

**Architecture:** A Parte A já entregou o conector (`readMetric` incluído), o `WorkspaceIntegration` selado e o `MetricBinding` com rotas. Esta parte acrescenta um leitor único — `createMeasurementReader` — que junta experimento + amarração + credencial e devolve uma leitura, e o usa em dois lugares: `GET /experiments/:id/measurement-proposal` (transitória, nada persistido) e `POST /experiments/:id/outcomes` com `fromSource: true` (que **refaz a leitura** em vez de aceitar o número do browser). O `Outcome` ganha quatro colunas nuláveis de proveniência. No frontend, três componentes novos; o caminho manual de hoje continua intacto ao lado.

**Tech Stack:** Node 22, Fastify 5, TypeScript strict ESM (`.js` nos imports), Zod 3 + `fastify-type-provider-zod`, Prisma 6 + PostgreSQL, Vitest. Web: Vite + React 19, Tailwind + shadcn/ui, Kubb + React Query, react-hook-form + zodResolver, i18next pt/en/es.

**Spec:** `docs/superpowers/specs/2026-08-04-medicao-automatica-ga4-design.md` — esta parte implementa §7, §8, §9, os itens de §11 que sobraram, e os passos 4 e 5 de §12.

## Global Constraints

Copiadas do spec e das regras do repositório. Valem em **toda** task.

- **Nenhum código gera, infere ou assume `baselineValue`, `targetValue`, `startDate` ou `endDate`.** Sem `startDate`/`endDate` declarados não há período, e a rota recusa (spec §7).
- **Um Outcome só nasce de confirmação humana.** Nada nesta parte grava Outcome sozinho: não há job de fundo, não há tabela de propostas (spec §7).
- **Nada produz veredito de sucesso a partir de aritmética** (`docs/domains/experiments.md` §14).
- **O `value` do corpo é recusado no caminho de fonte.** Com `fromSource: true` o cliente não manda valor nenhum; o serviço lê pelo conector. Aceitar `value` + `source: 'GA4'` do browser seria "um número sem origem com selo de origem" (spec §8).
- **Zero da fonte é uma resposta, não uma falha.** "a fonte respondeu zero" e "não deu para ler" são estados distintos na API e na tela (spec §9).
- **Isolamento de tenant absoluto:** `workspaceId` sempre de `req.tenant`, nunca de body/query/params. Um experimento de outro workspace é indistinguível de inexistente.
- **O segredo nunca sai numa resposta.** Nenhuma rota devolve `ciphertext`, `iv`, `authTag` nem o JSON da credencial. `openIntegrationCredential` é o único caminho para texto claro, e nenhum controller o chama direto.
- **Escopo GA4 somente leitura:** `https://www.googleapis.com/auth/analytics.readonly`. Nada no código pede escopo de escrita.
- **Nenhum teste toca a rede.** Provider e leitor entram por parâmetro (opção de plugin ou dep de fábrica), nunca por decorator ambiente — um teste que esquecesse de decorar sairia chamando o Google de dentro da suíte.
- **NEVER `prisma migrate dev`, NEVER `migrate reset`.** Escreva `migration.sql` à mão e aplique com `pnpm prisma:deploy`. Se `deploy` reclamar de drift, **pare e reporte**.
- **Commit exige aprovação explícita.** Cada task termina em `git add` + `git status` + diff resumido; **não rode `git commit` sem o "ok" do humano.**
- **Tailwind + shadcn/ui apenas** no web. Sem CSS puro, sem `style={{}}`. Todo termo de domínio novo ganha `Help`.
- **i18n em pt/en/es sempre nas três.** `src/i18n/locales.test.ts` compara as chaves das três árvores: uma chave só em `en.json` quebra a suíte.

---

## File Structure

### Backend

| arquivo | responsabilidade |
|---|---|
| `prisma/migrations/20260804140000_outcome_provenance/migration.sql` (criar) | quatro colunas nuláveis em `Outcome` |
| `prisma/schema.prisma` (modificar, `model Outcome`) | as mesmas quatro colunas |
| `src/http/api/outcomes/outcomes.schema.ts` (modificar) | proveniência na resposta |
| `src/http/api/outcomes/outcomes.presenter.ts` (modificar) | repassa a proveniência |
| `src/http/api/outcomes/outcomes.repository.ts` (modificar) | `OutcomeData` aceita a proveniência |
| `src/shared/errors/catalog.ts` + `src/shared/errors/i18n/*.json` (modificar) | quatro códigos novos |
| `src/lib/errors.ts` (modificar) | quatro classes novas |
| `src/measurement/read-measurement.ts` (criar) | **o leitor**: experimento + amarração + credencial → uma leitura |
| `src/measurement/read-measurement.test.ts` (criar) | as recusas, a leitura feliz, o `markFailed` |
| `src/http/api/experiments/measurement-proposal/measurement-proposal.controller.ts` (criar) | `GET /experiments/:id/measurement-proposal` |
| `src/http/api/experiments/measurement-proposal/measurement-proposal.schema.ts` (criar) | resposta da proposta |
| `src/http/api/experiments/measurement-proposal/measurement-proposal.test.ts` (criar) | recusas distintas, cross-tenant, zero |
| `src/http/api/experiments/index.ts` (modificar) | registra a rota, repassa a opção `read` |
| `src/http/api/outcomes/create-outcome/create-outcome.schema.ts` (modificar) | `fromSource`, `value` condicional |
| `src/http/api/outcomes/create-outcome/create-outcome.service.ts` (modificar) | refaz a leitura, grava proveniência |
| `src/http/api/outcomes/create-outcome/create-outcome.controller.ts` (modificar) | opção de plugin `read` |
| `src/http/api/outcomes/index.ts` (modificar) | repassa a opção |

`src/measurement/` é módulo novo no mesmo nível de `src/billing/` e `src/schedule/`: o leitor é consumido por duas famílias de rotas (`experiments` e `outcomes`), então não pertence a nenhuma das duas.

### Frontend

| arquivo | responsabilidade |
|---|---|
| `src/pages/IntegrationsPage.tsx` (criar) | casca da tela de conexão |
| `src/components/integrations/Ga4ConnectionCard.tsx` (criar) | conectar / status / desconectar |
| `src/components/integrations/Ga4ConnectionCard.test.tsx` (criar) | inclui a trava de "nunca mostra o segredo" |
| `src/App.tsx` (modificar) | rota `/app/settings/integrations` |
| `src/components/AppLayout.tsx` (modificar) | item no `secondaryNav` |
| `src/schemas/metric-binding.ts` (criar) | schema do formulário + parse da saída do agente |
| `src/components/experiments/MetricBindingCard.tsx` (criar) | amarração + botão de IA |
| `src/components/experiments/MetricBindingCard.test.tsx` (criar) | |
| `src/components/experiments/MeasurementProposalCard.tsx` (criar) | proposta + confirmar |
| `src/components/experiments/MeasurementProposalCard.test.tsx` (criar) | zero, recusas, coexistência com o manual |
| `src/pages/ExperimentDetailPage.tsx` (modificar) | monta os dois cards |
| `src/i18n/locales/{en,pt,es}.json` (modificar) | copy das três telas |

---

## Task 1: Proveniência no `Outcome`

**Files:**
- Create: `back/prisma/migrations/20260804140000_outcome_provenance/migration.sql`
- Modify: `back/prisma/schema.prisma` (`model Outcome`, linhas 436-453)
- Modify: `back/src/http/api/outcomes/outcomes.repository.ts` (`OutcomeData`)
- Modify: `back/src/http/api/outcomes/outcomes.presenter.ts`
- Modify: `back/src/http/api/outcomes/outcomes.schema.ts` (`outcomeSchema`)
- Test: `back/src/http/api/outcomes/outcomes.test.ts` (acrescentar casos)

**Interfaces:**
- Produces: `OutcomeData` com `periodStart?: Date`, `periodEnd?: Date`, `externalRef?: string`, `sourceDetail?: Prisma.InputJsonValue`; `outcomeSchema` com os mesmos quatro campos nuláveis na resposta.

- [ ] **Step 1: Escreva os testes que falham**

Em `back/src/http/api/outcomes/outcomes.test.ts`, acrescente ao `describe('GET /experiments/:id/outcomes')` existente (se não houver esse describe, crie um novo no fim do arquivo). O `prismaFake` do arquivo devolve `OUTCOMES` em `findMany`; acrescente a proveniência ao objeto `OUTCOMES[0]` **como um segundo item da lista**, para que o caso manual (sem proveniência) continue coberto pelo primeiro:

```ts
// Acrescente ao final do array OUTCOMES, depois do item existente:
  {
    id: '66666666-6666-6666-6666-666666666666',
    workspaceId: WORKSPACE_ID,
    experimentId: EXPERIMENT_ID,
    metric: 'discovery_calls_booked',
    value: 14,
    unit: null,
    observedAt: new Date('2026-07-21T00:00:00Z'),
    source: 'GA4',
    periodStart: new Date('2026-07-01T00:00:00Z'),
    periodEnd: new Date('2026-07-14T00:00:00Z'),
    externalRef: 'properties/123456789:conversions',
    sourceDetail: { metrics: [{ name: 'conversions' }] },
    createdAt: new Date('2026-07-21T00:00:00Z'),
    updatedAt: new Date('2026-07-21T00:00:00Z'),
  },
```

E os dois casos novos:

```ts
describe('proveniência na resposta', () => {
  it('devolve a proveniência do número que veio da fonte', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: `/experiments/${EXPERIMENT_ID}/outcomes` });

    expect(res.statusCode).toBe(200);
    const fromSource = res.json().outcomes.find((outcome: { source: string }) => outcome.source === 'GA4');
    expect(fromSource).toMatchObject({
      source: 'GA4',
      externalRef: 'properties/123456789:conversions',
      sourceDetail: { metrics: [{ name: 'conversions' }] },
    });
    expect(new Date(fromSource.periodStart).toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(new Date(fromSource.periodEnd).toISOString()).toBe('2026-07-14T00:00:00.000Z');
  });

  // O Outcome digitado à mão continua existindo e continua válido: a
  // proveniência dele é `source: 'USER'` e o observedAt informado (spec §8).
  it('devolve nulos na proveniência do número digitado à mão', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: `/experiments/${EXPERIMENT_ID}/outcomes` });

    const manual = res.json().outcomes.find((outcome: { source: string }) => outcome.source === 'USER');
    expect(manual).toMatchObject({
      source: 'USER',
      periodStart: null,
      periodEnd: null,
      externalRef: null,
      sourceDetail: null,
    });
  });
});
```

- [ ] **Step 2: Rode e confirme que falham**

Run: `cd back && pnpm vitest run src/http/api/outcomes/outcomes.test.ts`
Expected: FAIL — a resposta não tem `externalRef`/`periodStart` (o schema Zod de resposta os remove na serialização).

- [ ] **Step 3: Migração à mão**

`back/prisma/migrations/20260804140000_outcome_provenance/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "Outcome" ADD COLUMN     "periodStart" TIMESTAMP(3),
ADD COLUMN     "periodEnd" TIMESTAMP(3),
ADD COLUMN     "externalRef" TEXT,
ADD COLUMN     "sourceDetail" JSONB;
```

Nuláveis sem default: uma coluna com default seria proveniência inventada para as linhas antigas.

- [ ] **Step 4: `model Outcome` no schema**

Em `back/prisma/schema.prisma`, dentro de `model Outcome`, depois de `source String @default("USER")`:

```prisma
  /** O período que este número mede. Nulo no Outcome digitado à mão. */
  periodStart  DateTime?
  periodEnd    DateTime?
  /** Referência externa do que foi lido: property + consulta. */
  externalRef  String?
  /** A consulta exata que produziu o número, como a fonte a recebeu. */
  sourceDetail Json?
```

- [ ] **Step 5: Aplique e gere o client**

Run: `cd back && pnpm prisma:deploy && pnpm prisma:generate`
Expected: `1 migration found` aplicada, e depois `Database schema is up to date!` em `pnpm prisma migrate status`. Se aparecer drift de checksum em migração antiga, **pare e reporte** — não conserte com `reset`.

- [ ] **Step 6: Repositório, presenter e schema de resposta**

`back/src/http/api/outcomes/outcomes.repository.ts` — troque o import e a interface:

```ts
import type { PrismaClient, Prisma } from '@prisma/client';

export interface OutcomeData {
  experimentId: string;
  metric: string;
  value: number;
  unit?: string;
  observedAt?: Date;
  source?: string;
  /** Proveniência do número lido de uma fonte. Ausente no caminho manual. */
  periodStart?: Date;
  periodEnd?: Date;
  externalRef?: string;
  sourceDetail?: Prisma.InputJsonValue;
}
```

`back/src/http/api/outcomes/outcomes.presenter.ts` — dentro do objeto devolvido por `presentOutcome`, depois de `source: row.source,`:

```ts
    // Proveniência: nula no número digitado à mão, preenchida no que veio de
    // uma fonte. Repassada e não recalculada — ela é o registro do que foi
    // lido, não uma conclusão sobre isso.
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    externalRef: row.externalRef,
    sourceDetail: row.sourceDetail,
```

`back/src/http/api/outcomes/outcomes.schema.ts` — em `outcomeSchema`, depois de `source: z.string(),`:

```ts
  // `analytics.md` §11 pede source, external reference, observed at e ingestion
  // method. `sourceDetail` é o método por extenso — a consulta como a fonte a
  // recebeu — e não um enum vago. `confidence` fica fora de propósito: com uma
  // fonte só não há discordância a modelar (spec §8).
  periodStart: z.date().nullable(),
  periodEnd: z.date().nullable(),
  externalRef: z.string().nullable(),
  sourceDetail: z.unknown().nullable(),
```

- [ ] **Step 7: Rode os testes**

Run: `cd back && pnpm vitest run src/http/api/outcomes && pnpm typecheck`
Expected: PASS, tsc exit 0.

- [ ] **Step 8: Stage e mostre o diff (NÃO comite)**

```bash
cd back && git add prisma/schema.prisma prisma/migrations/20260804140000_outcome_provenance src/http/api/outcomes
git status --short && git diff --cached --stat
```

Mensagem sugerida para quando o humano aprovar: `feat(outcomes): record where a measurement came from`

---

## Task 2: O leitor — `createMeasurementReader`

**Files:**
- Create: `back/src/measurement/read-measurement.ts`
- Create: `back/src/measurement/read-measurement.test.ts`
- Modify: `back/src/shared/errors/catalog.ts`
- Modify: `back/src/shared/errors/i18n/pt-BR.json`, `en-US.json`, `es-ES.json`
- Modify: `back/src/lib/errors.ts`

**Interfaces:**
- Consumes: `createGa4Provider`, `serviceAccountMinter`, `AnalyticsProviderError`, tipo `AnalyticsProvider` de `src/integrations/analytics/index.js`; `createIntegrationsRepository` e `openIntegrationCredential` de `src/http/api/integrations/`.
- Produces:
  ```ts
  export type ExperimentMeasurement = {
    value: number; unit: string | null; periodStart: Date; periodEnd: Date;
    externalRef: string; query: unknown; source: string;
  };
  export type MeasurementReader = (workspaceId: string, experimentId: string, signal: AbortSignal) => Promise<ExperimentMeasurement>;
  export type CreateProvider = (args: { propertyId: string; credentials: string }) => AnalyticsProvider;
  export function createMeasurementReader(deps: { prisma: PrismaClient; createProvider?: CreateProvider }): MeasurementReader;
  ```
  E quatro classes de erro: `NoMetricBindingError`, `NoAnalyticsSourceError`, `NoMeasurementPeriodError`, `MeasurementReadFailedError` (esta com `{ reason: string }`).

- [ ] **Step 1: Escreva os testes que falham**

`back/src/measurement/read-measurement.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsProviderError } from '../integrations/analytics/index.js';
import { seal } from '../billing/crypto.js';
import { createMeasurementReader } from './read-measurement.js';

const WORKSPACE_ID = 'ws-1';
const EXPERIMENT_ID = 'exp-1';

const SEALED = seal(JSON.stringify({ client_email: 'aurea@p.iam.gserviceaccount.com', private_key: 'pk' }));

const INTEGRATION = {
  id: 'int-1',
  workspaceId: WORKSPACE_ID,
  provider: 'GA4',
  authKind: 'SERVICE_ACCOUNT',
  ciphertext: new Uint8Array(SEALED.ciphertext),
  iv: new Uint8Array(SEALED.iv),
  authTag: new Uint8Array(SEALED.authTag),
  externalId: '123456789',
  accountLabel: 'aurea@p.iam.gserviceaccount.com',
  status: 'OK',
  lastCheckedAt: new Date('2026-08-04T00:00:00Z'),
  lastError: null,
};

const BINDING = {
  id: 'mb-1',
  workspaceId: WORKSPACE_ID,
  experimentId: EXPERIMENT_ID,
  provider: 'GA4',
  config: { metric: 'conversions', dimensionFilter: { fieldName: 'eventName', value: 'sign_up' } },
};

const EXPERIMENT = {
  id: EXPERIMENT_ID,
  startDate: new Date('2026-07-01T00:00:00Z'),
  endDate: new Date('2026-07-14T00:00:00Z'),
};

/**
 * `'key' in over`, e não `??`: os casos negativos passam `null` de propósito, e
 * `??` devolveria o default de qualquer jeito — o teste passaria sem que a
 * recusa existisse.
 */
function prismaFake(over: { experiment?: unknown; binding?: unknown; integration?: unknown } = {}) {
  return {
    experiment: {
      findFirst: vi.fn().mockResolvedValue('experiment' in over ? over.experiment : EXPERIMENT),
    },
    metricBinding: {
      findFirst: vi.fn().mockResolvedValue('binding' in over ? over.binding : BINDING),
    },
    workspaceIntegration: {
      findFirst: vi.fn().mockResolvedValue('integration' in over ? over.integration : INTEGRATION),
      update: vi.fn().mockResolvedValue(INTEGRATION),
    },
  };
}

const READING = {
  value: 42,
  unit: null,
  externalRef: 'properties/123456789:conversions',
  query: { metrics: [{ name: 'conversions' }] },
};

function providerFake(readMetric = vi.fn().mockResolvedValue(READING)) {
  return {
    readMetric,
    factory: vi.fn().mockReturnValue({
      name: 'ga4',
      health: vi.fn(),
      listMetrics: vi.fn(),
      readMetric,
    }),
  };
}

beforeEach(() => vi.clearAllMocks());

const signal = () => AbortSignal.timeout(1000);

describe('createMeasurementReader', () => {
  it('lê a métrica amarrada no período declarado do experimento', async () => {
    const provider = providerFake();
    const prisma = prismaFake();
    const read = createMeasurementReader({ prisma: prisma as never, createProvider: provider.factory });

    const result = await read(WORKSPACE_ID, EXPERIMENT_ID, signal());

    expect(result).toMatchObject({
      value: 42,
      unit: null,
      externalRef: 'properties/123456789:conversions',
      source: 'GA4',
    });
    expect(result.periodStart.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(result.periodEnd.toISOString()).toBe('2026-07-14T00:00:00.000Z');
    // O período vai para o conector como as datas do experimento, não como uma
    // janela derivada de "hoje": duas regras de período mediriam testes
    // diferentes (spec §7).
    expect(provider.readMetric).toHaveBeenCalledWith(
      BINDING.config,
      { startDate: EXPERIMENT.startDate, endDate: EXPERIMENT.endDate },
      expect.anything(),
    );
  });

  it('abre a credencial selada e monta o provider com a property gravada', async () => {
    const provider = providerFake();
    const read = createMeasurementReader({ prisma: prismaFake() as never, createProvider: provider.factory });

    await read(WORKSPACE_ID, EXPERIMENT_ID, signal());

    expect(provider.factory).toHaveBeenCalledWith({
      propertyId: '123456789',
      credentials: expect.stringContaining('private_key'),
    });
  });

  it('lê apenas dentro do workspace do tenant', async () => {
    const prisma = prismaFake();
    const read = createMeasurementReader({ prisma: prisma as never, createProvider: providerFake().factory });

    await read(WORKSPACE_ID, EXPERIMENT_ID, signal());

    expect(prisma.experiment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: EXPERIMENT_ID, workspaceId: WORKSPACE_ID } }),
    );
    expect(prisma.metricBinding.findFirst).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, experimentId: EXPERIMENT_ID },
    });
  });

  it('um experimento de outro workspace é indistinguível de inexistente', async () => {
    const read = createMeasurementReader({
      prisma: prismaFake({ experiment: null }) as never,
      createProvider: providerFake().factory,
    });

    await expect(read(WORKSPACE_ID, EXPERIMENT_ID, signal())).rejects.toMatchObject({ code: 'AUR-T0005' });
  });

  // As três recusas de setup, com códigos distintos: a tela precisa saber se
  // pede amarração, conexão ou datas (spec §9 e §11).
  it('recusa sem amarração, com código próprio', async () => {
    const provider = providerFake();
    const read = createMeasurementReader({
      prisma: prismaFake({ binding: null }) as never,
      createProvider: provider.factory,
    });

    await expect(read(WORKSPACE_ID, EXPERIMENT_ID, signal())).rejects.toMatchObject({
      code: 'AUR-T0036',
      statusCode: 400,
    });
    expect(provider.readMetric).not.toHaveBeenCalled();
  });

  it('recusa sem fonte conectada, com código próprio', async () => {
    const read = createMeasurementReader({
      prisma: prismaFake({ integration: null }) as never,
      createProvider: providerFake().factory,
    });

    await expect(read(WORKSPACE_ID, EXPERIMENT_ID, signal())).rejects.toMatchObject({
      code: 'AUR-T0037',
      statusCode: 400,
    });
  });

  it('recusa sem período declarado, e não inventa um', async () => {
    const provider = providerFake();
    const read = createMeasurementReader({
      prisma: prismaFake({ experiment: { id: EXPERIMENT_ID, startDate: null, endDate: null } }) as never,
      createProvider: provider.factory,
    });

    await expect(read(WORKSPACE_ID, EXPERIMENT_ID, signal())).rejects.toMatchObject({
      code: 'AUR-T0038',
      statusCode: 400,
    });
    expect(provider.readMetric).not.toHaveBeenCalled();
  });

  it('recusa quando só uma das duas datas existe', async () => {
    const read = createMeasurementReader({
      prisma: prismaFake({
        experiment: { id: EXPERIMENT_ID, startDate: new Date('2026-07-01T00:00:00Z'), endDate: null },
      }) as never,
      createProvider: providerFake().factory,
    });

    await expect(read(WORKSPACE_ID, EXPERIMENT_ID, signal())).rejects.toMatchObject({ code: 'AUR-T0038' });
  });

  it('grava FAILED com a mensagem da própria fonte quando a leitura é recusada', async () => {
    const provider = providerFake(
      vi.fn().mockRejectedValue(new AnalyticsProviderError('Caller does not have permission.')),
    );
    const prisma = prismaFake();
    const read = createMeasurementReader({ prisma: prisma as never, createProvider: provider.factory });

    await expect(read(WORKSPACE_ID, EXPERIMENT_ID, signal())).rejects.toMatchObject({
      code: 'AUR-T0039',
      // A mensagem da fonte chega ao fundador nos detalhes: "Caller does not
      // have permission" diz o que fazer; "falha ao medir" não diz nada.
      details: { reason: 'Caller does not have permission.' },
    });
    expect(prisma.workspaceIntegration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'int-1' },
        data: expect.objectContaining({ status: 'FAILED', lastError: 'Caller does not have permission.' }),
      }),
    );
  });

  // Zero é uma resposta. Ele sobe como 0 e não como recusa — confundir os dois é
  // como o tracking quebrado entra no Growth Brain disfarçado de resultado ruim.
  it('devolve zero como leitura, não como falha', async () => {
    const provider = providerFake(vi.fn().mockResolvedValue({ ...READING, value: 0 }));
    const read = createMeasurementReader({ prisma: prismaFake() as never, createProvider: provider.factory });

    await expect(read(WORKSPACE_ID, EXPERIMENT_ID, signal())).resolves.toMatchObject({ value: 0 });
  });
});
```

- [ ] **Step 2: Rode e confirme que falham**

Run: `cd back && pnpm vitest run src/measurement`
Expected: FAIL — `Cannot find module './read-measurement.js'`.

- [ ] **Step 3: Os quatro códigos no catálogo**

`back/src/shared/errors/catalog.ts` — acrescente depois de `AGENT_RUN_IN_PROGRESS`:

```ts
  NO_METRIC_BINDING: { code: 'AUR-T0036', status: 400 },
  NO_ANALYTICS_SOURCE: { code: 'AUR-T0037', status: 400 },
  NO_MEASUREMENT_PERIOD: { code: 'AUR-T0038', status: 400 },
  // 502 e não 400: a requisição está correta e o recurso existe — quem recusou
  // foi a fonte. Um 400 aqui mandaria o fundador corrigir o que ele acertou.
  MEASUREMENT_READ_FAILED: { code: 'AUR-T0039', status: 502 },
```

`back/src/shared/errors/i18n/pt-BR.json` (acrescente as quatro chaves; lembre da vírgula na linha anterior):

```json
  "AUR-T0036": "Este experimento ainda não diz de onde vem o número dele. Amarre uma métrica da sua fonte de dados.",
  "AUR-T0037": "Nenhuma fonte de dados está conectada a este workspace.",
  "AUR-T0038": "Este experimento não tem data de início e fim declaradas, e sem período não há o que medir.",
  "AUR-T0039": "A fonte não devolveu a medição: {{reason}}"
```

`en-US.json`:

```json
  "AUR-T0036": "This experiment does not say yet where its number comes from. Bind a metric from your data source.",
  "AUR-T0037": "No data source is connected to this workspace.",
  "AUR-T0038": "This experiment has no declared start and end dates, and without a period there is nothing to measure.",
  "AUR-T0039": "The source did not return the measurement: {{reason}}"
```

`es-ES.json`:

```json
  "AUR-T0036": "Este experimento aún no dice de dónde viene su número. Vincula una métrica de tu fuente de datos.",
  "AUR-T0037": "Ninguna fuente de datos está conectada a este espacio de trabajo.",
  "AUR-T0038": "Este experimento no tiene fechas de inicio y fin declaradas, y sin periodo no hay nada que medir.",
  "AUR-T0039": "La fuente no devolvió la medición: {{reason}}"
```

- [ ] **Step 4: As quatro classes de erro**

`back/src/lib/errors.ts` — no fim do arquivo:

```ts
// As três recusas de setup da medição automática, com códigos distintos porque
// a tela decide coisas diferentes com cada uma: pedir amarração, pedir conexão,
// ou pedir as datas do experimento (spec §9).
export class NoMetricBindingError extends AppError {
  constructor() {
    const def = getErrorDef('NO_METRIC_BINDING');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

export class NoAnalyticsSourceError extends AppError {
  constructor() {
    const def = getErrorDef('NO_ANALYTICS_SOURCE');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

export class NoMeasurementPeriodError extends AppError {
  constructor() {
    const def = getErrorDef('NO_MEASUREMENT_PERIOD');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

/** A recusa da própria fonte, com a mensagem dela nos detalhes. */
export class MeasurementReadFailedError extends AppError {
  constructor(params: { reason: string }) {
    const def = getErrorDef('MEASUREMENT_READ_FAILED');
    super(def.status, def.code, translateError(def.code, 'pt-BR', params), params);
  }
}
```

- [ ] **Step 5: O leitor**

`back/src/measurement/read-measurement.ts`:

```ts
import type { PrismaClient } from '@prisma/client';
import {
  AnalyticsProviderError,
  createGa4Provider,
  serviceAccountMinter,
  type AnalyticsProvider,
} from '../integrations/analytics/index.js';
import { createIntegrationsRepository } from '../http/api/integrations/integrations.repository.js';
import { openIntegrationCredential } from '../http/api/integrations/integrations.service.js';
import {
  MeasurementReadFailedError,
  NoAnalyticsSourceError,
  NoMeasurementPeriodError,
  NoMetricBindingError,
  NotFoundError,
} from '../lib/errors.js';

/** Uma leitura pronta para virar proposta na tela ou proveniência no Outcome. */
export type ExperimentMeasurement = {
  value: number;
  unit: string | null;
  periodStart: Date;
  periodEnd: Date;
  externalRef: string;
  /** A consulta exata que produziu o número, como a fonte a recebeu. */
  query: unknown;
  /** O provider que devolveu o número. Vai para `Outcome.source`. */
  source: string;
};

export type MeasurementReader = (
  workspaceId: string,
  experimentId: string,
  signal: AbortSignal,
) => Promise<ExperimentMeasurement>;

/**
 * A fábrica do conector, injetável. É este o seam que mantém a suíte fora da
 * rede: nenhum teste precisa lembrar de substituir um decorator ambiente.
 */
export type CreateProvider = (args: { propertyId: string; credentials: string }) => AnalyticsProvider;

const defaultCreateProvider: CreateProvider = ({ propertyId, credentials }) =>
  createGa4Provider({ propertyId, mintToken: serviceAccountMinter(credentials) });

/**
 * O único caminho que transforma "este experimento" num número lido de fora.
 *
 * Usado em dois lugares — a proposta transitória e a confirmação que grava o
 * Outcome — de propósito: se a confirmação usasse outro caminho, o número
 * gravado poderia não ser o número mostrado.
 *
 * A ordem das recusas é amarração → fonte → período, e ela é deliberada: sem
 * amarração não se sabe nem qual provider consultar, e sem fonte não há o que
 * abrir. Cada recusa tem código próprio porque a tela faz coisas diferentes
 * com cada uma.
 */
export function createMeasurementReader(deps: {
  prisma: PrismaClient;
  createProvider?: CreateProvider;
}): MeasurementReader {
  const createProvider = deps.createProvider ?? defaultCreateProvider;
  const integrations = createIntegrationsRepository(deps.prisma);

  return async (workspaceId, experimentId, signal) => {
    const experiment = await deps.prisma.experiment.findFirst({
      where: { id: experimentId, workspaceId },
      select: { id: true, startDate: true, endDate: true },
    });
    // Escopado pelo workspace: um id de outro tenant lê como ausente.
    if (!experiment) throw new NotFoundError('Experiment not found');

    const binding = await deps.prisma.metricBinding.findFirst({ where: { workspaceId, experimentId } });
    if (!binding) throw new NoMetricBindingError();

    const row = await integrations.find(workspaceId, binding.provider);
    if (!row) throw new NoAnalyticsSourceError();

    // As datas que o fundador declarou, e as mesmas que o relógio cumpriu.
    // Nenhum default: um período inventado mede outro experimento (spec §7).
    const { startDate, endDate } = experiment;
    if (!startDate || !endDate) throw new NoMeasurementPeriodError();

    const provider = createProvider({
      propertyId: row.externalId,
      credentials: openIntegrationCredential(row),
    });

    try {
      const reading = await provider.readMetric(binding.config, { startDate, endDate }, signal);
      return {
        value: reading.value,
        unit: reading.unit,
        periodStart: startDate,
        periodEnd: endDate,
        externalRef: reading.externalRef,
        query: reading.query,
        source: binding.provider,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      // O status guardado passa a FAILED com a mensagem da fonte: a tela de
      // conexão é onde o fundador vai olhar depois, e ela não pode custar uma
      // ida ao Google por render (spec §4).
      if (error instanceof AnalyticsProviderError) {
        await integrations.markFailed(row.id, reason, new Date());
      }
      throw new MeasurementReadFailedError({ reason });
    }
  };
}
```

- [ ] **Step 6: Rode os testes**

Run: `cd back && pnpm vitest run src/measurement src/shared/errors && pnpm typecheck`
Expected: PASS (inclusive `i18n.test.ts`, que compara as chaves dos três bundles), tsc exit 0.

- [ ] **Step 7: Stage e mostre o diff (NÃO comite)**

```bash
cd back && git add src/measurement src/lib/errors.ts src/shared/errors
git status --short && git diff --cached --stat
```

Mensagem sugerida: `feat(measurement): read an experiment's metric through its binding`

---

## Task 3: `GET /experiments/:id/measurement-proposal`

**Files:**
- Create: `back/src/http/api/experiments/measurement-proposal/measurement-proposal.schema.ts`
- Create: `back/src/http/api/experiments/measurement-proposal/measurement-proposal.controller.ts`
- Create: `back/src/http/api/experiments/measurement-proposal/measurement-proposal.test.ts`
- Modify: `back/src/http/api/experiments/index.ts`

**Interfaces:**
- Consumes: `createMeasurementReader`, tipos `MeasurementReader`/`ExperimentMeasurement` de `src/measurement/read-measurement.js`; `experimentIdParam` de `../experiments.schema.js`.
- Produces: `measurementProposalRoute: FastifyPluginAsync<MeasurementProposalOptions>` com `export type MeasurementProposalOptions = { read?: MeasurementReader }`; `experimentsRoutes` passa a ser `FastifyPluginAsync<MeasurementProposalOptions>`.

- [ ] **Step 1: Escreva os testes que falham**

`back/src/http/api/experiments/measurement-proposal/measurement-proposal.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError, NoMetricBindingError, MeasurementReadFailedError } from '../../../../lib/errors.js';
import { measurementProposalRoute } from './measurement-proposal.controller.js';

const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';
const EXPERIMENT_ID = '11111111-1111-1111-1111-111111111111';

const READING = {
  value: 42,
  unit: null,
  periodStart: new Date('2026-07-01T00:00:00Z'),
  periodEnd: new Date('2026-07-14T00:00:00Z'),
  externalRef: 'properties/123456789:conversions',
  query: { metrics: [{ name: 'conversions' }] },
  source: 'GA4',
};

beforeEach(() => vi.clearAllMocks());

/**
 * O leitor entra por opção de plugin. Sem isto o teste construiria o leitor
 * real e sairia chamando o Google de dentro da suíte.
 */
async function buildApp(read: ReturnType<typeof vi.fn>) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', {} as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: WORKSPACE_ID, role: 'MEMBER' };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, details: error.details } });
    }
    throw error;
  });
  await app.register(measurementProposalRoute, { read });
  return app;
}

const url = `/experiments/${EXPERIMENT_ID}/measurement-proposal`;

describe('GET /experiments/:id/measurement-proposal', () => {
  it('devolve o número, o período, a fonte e a consulta', async () => {
    const read = vi.fn().mockResolvedValue(READING);
    const app = await buildApp(read);

    const res = await app.inject({ method: 'GET', url });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      value: 42,
      unit: null,
      externalRef: 'properties/123456789:conversions',
      source: 'GA4',
      query: { metrics: [{ name: 'conversions' }] },
    });
  });

  it('lê com o workspace do tenant, nunca com um id do caminho', async () => {
    const read = vi.fn().mockResolvedValue(READING);
    const app = await buildApp(read);

    await app.inject({ method: 'GET', url });

    expect(read).toHaveBeenCalledWith(WORKSPACE_ID, EXPERIMENT_ID, expect.anything());
  });

  // Transitória de propósito: confirmar é o POST /outcomes que já existe. Uma
  // rota GET que gravasse criaria Outcome sem confirmação humana (spec §7).
  it('não persiste nada', async () => {
    const read = vi.fn().mockResolvedValue(READING);
    const app = await buildApp(read);

    const res = await app.inject({ method: 'GET', url });

    expect(res.statusCode).toBe(200);
    // Nenhuma escrita possível: o app foi montado com um prisma vazio, então
    // qualquer tentativa de gravar teria estourado antes de responder 200.
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('propaga a recusa do leitor com o código dela', async () => {
    const read = vi.fn().mockRejectedValue(new NoMetricBindingError());
    const app = await buildApp(read);

    const res = await app.inject({ method: 'GET', url });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AUR-T0036');
  });

  it('propaga a mensagem da fonte quando ela recusa', async () => {
    const read = vi.fn().mockRejectedValue(new MeasurementReadFailedError({ reason: 'Property not found.' }));
    const app = await buildApp(read);

    const res = await app.inject({ method: 'GET', url });

    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatchObject({ code: 'AUR-T0039', details: { reason: 'Property not found.' } });
  });

  it('devolve zero como zero', async () => {
    const read = vi.fn().mockResolvedValue({ ...READING, value: 0 });
    const app = await buildApp(read);

    const res = await app.inject({ method: 'GET', url });

    expect(res.statusCode).toBe(200);
    expect(res.json().value).toBe(0);
  });

  it('recusa um id que não é uuid antes de chamar o leitor', async () => {
    const read = vi.fn();
    const app = await buildApp(read);

    const res = await app.inject({ method: 'GET', url: '/experiments/nope/measurement-proposal' });

    expect(res.statusCode).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rode e confirme que falham**

Run: `cd back && pnpm vitest run src/http/api/experiments/measurement-proposal`
Expected: FAIL — `Cannot find module './measurement-proposal.controller.js'`.

- [ ] **Step 3: Schema da resposta**

`back/src/http/api/experiments/measurement-proposal/measurement-proposal.schema.ts`:

```ts
import { z } from 'zod';

/**
 * Plana, e não embrulhada em `{ proposal }` como as respostas de entidade: isto
 * não é um recurso do Growth Brain, é uma leitura transitória — nada foi
 * gravado, e não há id para buscar de volta (spec §7).
 */
export const measurementProposalResponse = z.object({
  value: z.number(),
  /** Null quando a fonte não declara unidade — não é o mesmo que adimensional. */
  unit: z.string().nullable(),
  periodStart: z.date(),
  periodEnd: z.date(),
  externalRef: z.string(),
  /** A consulta exata que produziu o número, para o fundador poder auditá-la. */
  query: z.unknown(),
  source: z.string(),
});
```

- [ ] **Step 4: Controller**

`back/src/http/api/experiments/measurement-proposal/measurement-proposal.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createMeasurementReader, type MeasurementReader } from '../../../../measurement/read-measurement.js';
import { experimentIdParam } from '../experiments.schema.js';
import { measurementProposalResponse } from './measurement-proposal.schema.js';

/**
 * O leitor entra por opção de plugin, não por decorator no `app` — mesma razão
 * de `put-integration.controller.ts`: um teste que esquecesse de decorá-lo
 * cairia no leitor real e sairia chamando o Google de dentro da suíte.
 */
export type MeasurementProposalOptions = { read?: MeasurementReader };

/** Um relatório é mais caro que um metadata; ainda assim, tem teto. */
const TIMEOUT_MS = 20_000;

export const measurementProposalRoute: FastifyPluginAsync<MeasurementProposalOptions> = async (app, opts) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/experiments/:id/measurement-proposal',
    {
      schema: {
        tags: ['experiments'],
        operationId: 'getMeasurementProposal',
        params: experimentIdParam,
        response: { 200: measurementProposalResponse },
      },
    },
    async (req, reply) => {
      const read = opts.read ?? createMeasurementReader({ prisma: app.prisma });
      const reading = await read(req.tenant.workspaceId, req.params.id, AbortSignal.timeout(TIMEOUT_MS));
      return reply.send(reading);
    },
  );
};
```

- [ ] **Step 5: Registre a rota**

`back/src/http/api/experiments/index.ts` — troque a assinatura e acrescente o registro:

```ts
import { measurementProposalRoute, type MeasurementProposalOptions } from './measurement-proposal/measurement-proposal.controller.js';

export const experimentsRoutes: FastifyPluginAsync<MeasurementProposalOptions> = async (app, opts) => {
```

e, depois de `await app.register(removeMetricBindingRoute);`:

```ts
  // O leitor viaja como opção para o teste poder substituí-lo. Sem opção, o
  // leitor real é usado.
  await app.register(measurementProposalRoute, { read: opts.read });
```

`src/app.ts` continua registrando `experimentsRoutes` sem opções: `opts.read` fica `undefined` e o leitor real é construído. Não mexa em `app.ts`.

- [ ] **Step 6: Rode os testes**

Run: `cd back && pnpm vitest run src/http/api/experiments && pnpm typecheck`
Expected: PASS, tsc exit 0.

- [ ] **Step 7: Stage e mostre o diff (NÃO comite)**

```bash
cd back && git add src/http/api/experiments
git status --short && git diff --cached --stat
```

Mensagem sugerida: `feat(experiments): propose the measurement a completed experiment has`

---

## Task 4: `create-outcome` com `fromSource` — a confirmação refaz a leitura

**Files:**
- Modify: `back/src/http/api/outcomes/create-outcome/create-outcome.schema.ts`
- Modify: `back/src/http/api/outcomes/create-outcome/create-outcome.service.ts`
- Modify: `back/src/http/api/outcomes/create-outcome/create-outcome.controller.ts`
- Modify: `back/src/http/api/outcomes/index.ts`
- Test: `back/src/http/api/outcomes/create-outcome/create-outcome.service.test.ts` (acrescentar)
- Test: `back/src/http/api/outcomes/outcomes.test.ts` (acrescentar)

**Interfaces:**
- Consumes: `MeasurementReader`, `ExperimentMeasurement`, `createMeasurementReader` de `src/measurement/read-measurement.js`; `OutcomeData` com proveniência (Task 1).
- Produces: `CreateOutcomeDeps` ganha `readMeasurement: MeasurementReader`; `createOutcomeRoute: FastifyPluginAsync<CreateOutcomeOptions>` com `export type CreateOutcomeOptions = { read?: MeasurementReader }`; `outcomesRoutes: FastifyPluginAsync<CreateOutcomeOptions>`.

- [ ] **Step 1: Escreva os testes de serviço que falham**

Em `back/src/http/api/outcomes/create-outcome/create-outcome.service.test.ts`, ajuste `deps()` para receber o leitor e acrescente o bloco novo:

```ts
// Substitua a função `deps` existente por esta:
function deps(startRun: ReturnType<typeof vi.fn>, readMeasurement = vi.fn()) {
  return {
    repo: {
      experimentInWorkspace: vi.fn().mockResolvedValue(EXPERIMENT),
      create: vi.fn().mockResolvedValue(ROW),
    } as never,
    startRun,
    readMeasurement,
  };
}

const READING = {
  value: 42,
  unit: null,
  periodStart: new Date('2026-07-01T00:00:00Z'),
  periodEnd: new Date('2026-07-14T00:00:00Z'),
  externalRef: 'properties/123456789:conversions',
  query: { metrics: [{ name: 'conversions' }] },
  source: 'GA4',
};

describe('createOutcomeService — leitura de fonte', () => {
  // A trava central do spec §8: confirmar é concordar com a leitura, não
  // transportá-la. O servidor refaz a leitura pelo conector.
  it('refaz a leitura e grava o que o conector devolveu, com proveniência', async () => {
    const read = vi.fn().mockResolvedValue(READING);
    const d = deps(vi.fn().mockResolvedValue({ id: 'run-1' }), read);

    await createOutcomeService(d)({
      fromSource: true,
      workspaceId: 'ws-1',
      experimentId: 'exp-1',
      tenant: TENANT,
    });

    expect(read).toHaveBeenCalledWith('ws-1', 'exp-1', expect.anything());
    const create = (d.repo as unknown as { create: ReturnType<typeof vi.fn> }).create;
    expect(create).toHaveBeenCalledWith('ws-1', expect.objectContaining({
      value: 42,
      source: 'GA4',
      periodStart: READING.periodStart,
      periodEnd: READING.periodEnd,
      externalRef: 'properties/123456789:conversions',
      sourceDetail: { metrics: [{ name: 'conversions' }] },
    }));
  });

  it('não chama o conector no caminho manual, e não grava proveniência', async () => {
    const read = vi.fn();
    const d = deps(vi.fn().mockResolvedValue({ id: 'run-1' }), read);

    await createOutcomeService(d)({ value: 6.1, workspaceId: 'ws-1', experimentId: 'exp-1', tenant: TENANT });

    expect(read).not.toHaveBeenCalled();
    const create = (d.repo as unknown as { create: ReturnType<typeof vi.fn> }).create;
    const data = create.mock.calls[0]![1] as Record<string, unknown>;
    expect(data).toMatchObject({ value: 6.1, source: 'USER' });
    expect(data.externalRef).toBeUndefined();
    expect(data.periodStart).toBeUndefined();
  });

  // A recusa da fonte não pode virar um Outcome vazio: sem número não há
  // medição, e gravar zero por falta de leitura seria inventar o resultado.
  it('não grava nada quando a leitura falha', async () => {
    const read = vi.fn().mockRejectedValue(new Error('Caller does not have permission.'));
    const startRun = vi.fn();
    const d = deps(startRun, read);

    await expect(
      createOutcomeService(d)({ fromSource: true, workspaceId: 'ws-1', experimentId: 'exp-1', tenant: TENANT }),
    ).rejects.toThrow(/permission/i);

    expect((d.repo as unknown as { create: ReturnType<typeof vi.fn> }).create).not.toHaveBeenCalled();
    expect(startRun).not.toHaveBeenCalled();
  });

  // Defesa em profundidade: o schema da rota já recusa, e um chamador interno
  // futuro não pode gravar um outcome sem número.
  it('recusa um pedido sem valor e sem fonte', async () => {
    const d = deps(vi.fn(), vi.fn());

    await expect(
      createOutcomeService(d)({ workspaceId: 'ws-1', experimentId: 'exp-1', tenant: TENANT } as never),
    ).rejects.toThrow(/value/i);
  });

  it('a unidade informada pelo humano vence a da fonte', async () => {
    const read = vi.fn().mockResolvedValue({ ...READING, unit: null });
    const d = deps(vi.fn().mockResolvedValue({ id: 'run-1' }), read);

    await createOutcomeService(d)({
      fromSource: true,
      unit: 'calls',
      workspaceId: 'ws-1',
      experimentId: 'exp-1',
      tenant: TENANT,
    });

    const create = (d.repo as unknown as { create: ReturnType<typeof vi.fn> }).create;
    expect(create.mock.calls[0]![1]).toMatchObject({ unit: 'calls' });
  });
});
```

Também atualize as chamadas `deps(startRun)` já existentes no arquivo — a assinatura ganhou um segundo parâmetro com default, então nenhuma delas precisa mudar.

- [ ] **Step 2: Escreva o teste de rota que falha**

Em `back/src/http/api/outcomes/outcomes.test.ts`, acrescente ao fim (e passe o leitor na montagem — veja o ajuste de `buildApp` no Step 4):

```ts
describe('POST /experiments/:id/outcomes — caminho de fonte', () => {
  // A trava que não pode ser afrouxada: aceitar `value` junto de `fromSource`
  // seria um número sem origem com selo de origem, pior que digitar à mão
  // porque parece auditado (spec §8).
  it('recusa um valor no corpo junto de fromSource', async () => {
    const read = vi.fn();
    const app = await buildApp(EXPERIMENT, read);

    const res = await app.inject({
      method: 'POST',
      url: `/experiments/${EXPERIMENT_ID}/outcomes`,
      payload: { fromSource: true, value: 999 },
    });

    expect(res.statusCode).toBe(400);
    expect(read).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('recusa um pedido sem valor e sem fromSource', async () => {
    const app = await buildApp(EXPERIMENT, vi.fn());

    const res = await app.inject({
      method: 'POST',
      url: `/experiments/${EXPERIMENT_ID}/outcomes`,
      payload: { unit: 'calls' },
    });

    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('grava o número da fonte com a proveniência', async () => {
    const read = vi.fn().mockResolvedValue({
      value: 42,
      unit: null,
      periodStart: new Date('2026-07-01T00:00:00Z'),
      periodEnd: new Date('2026-07-14T00:00:00Z'),
      externalRef: 'properties/123456789:conversions',
      query: { metrics: [{ name: 'conversions' }] },
      source: 'GA4',
    });
    const app = await buildApp(EXPERIMENT, read);

    const res = await app.inject({
      method: 'POST',
      url: `/experiments/${EXPERIMENT_ID}/outcomes`,
      payload: { fromSource: true },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().outcome).toMatchObject({
      value: 42,
      source: 'GA4',
      externalRef: 'properties/123456789:conversions',
    });
  });

  // O piso continua de pé: um experimento sem amarração mede como hoje. Este é
  // o teste que impede a automação de virar requisito (spec §11).
  it('o caminho manual continua gravando sem tocar no conector', async () => {
    const read = vi.fn();
    const app = await buildApp(EXPERIMENT, read);

    const res = await app.inject({
      method: 'POST',
      url: `/experiments/${EXPERIMENT_ID}/outcomes`,
      payload: { value: 9, unit: 'calls' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().outcome).toMatchObject({ value: 9, source: 'USER' });
    expect(read).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Rode e confirme que falham**

Run: `cd back && pnpm vitest run src/http/api/outcomes`
Expected: FAIL — `buildApp` ainda não aceita o segundo argumento e o schema aceita `{ fromSource: true, value: 999 }`.

- [ ] **Step 4: Ajuste o `buildApp` do teste de rota**

Em `back/src/http/api/outcomes/outcomes.test.ts`, troque a assinatura de `buildApp` (os chamadores existentes com zero ou um argumento continuam válidos):

```ts
async function buildApp(experiment: unknown = EXPERIMENT, read: ReturnType<typeof vi.fn> = vi.fn()) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prismaFake(experiment) as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: WORKSPACE_ID, role: 'MEMBER' };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
    throw error;
  });
  // O leitor por opção de plugin: sem isto, um teste do caminho de fonte
  // construiria o leitor real contra o prisma falso.
  await app.register(createOutcomeRoute, { read });
  await app.register(listOutcomesRoute);
  return app;
}
```

- [ ] **Step 5: Body com `fromSource`**

`back/src/http/api/outcomes/create-outcome/create-outcome.schema.ts` — substitua o arquivo:

```ts
import { z } from 'zod';

export const outcomeCreateBody = z
  .object({
    // Opcional no schema, obrigatório no caminho manual: o `refine` abaixo é
    // quem separa os dois. Finite de propósito: z.number() sozinho admite
    // Infinity e NaN, e nenhum dos dois é medição.
    value: z.number().finite().optional(),
    // Omitted means "the metric this experiment is about" — filled in by the
    // service from the experiment itself.
    metric: z.string().min(1).max(160).optional(),
    unit: z.string().max(40).optional(),
    observedAt: z.coerce.date().optional(),
    /**
     * "Concordo com a leitura da fonte." O cliente não manda valor nenhum: o
     * serviço lê pelo conector, usando a amarração e o período do experimento.
     *
     * Aceitar `value` junto seria um número sem origem com selo de origem,
     * pior que digitar à mão porque parece auditado (spec §8).
     */
    fromSource: z.boolean().optional(),
  })
  .refine((body) => (body.fromSource === true ? body.value === undefined : body.value !== undefined), {
    message: 'Send a value, or fromSource with no value',
    path: ['value'],
  });

export type OutcomeCreateBody = z.infer<typeof outcomeCreateBody>;
```

- [ ] **Step 6: Serviço**

`back/src/http/api/outcomes/create-outcome/create-outcome.service.ts` — acrescente o import e a dep, e substitua o trecho entre a checagem de `observedAt` e o `deps.repo.create`:

```ts
import type { Prisma } from '@prisma/client';
import type { ExperimentMeasurement, MeasurementReader } from '../../../../measurement/read-measurement.js';
```

```ts
export type CreateOutcomeDeps = {
  repo: OutcomesRepository;
  /**
   * O serviço de criação de run, injetado. É ele que valida input, roda o
   * precheck, cobra e deduplica — reimplementar aqui seria um segundo caminho
   * de cobrança livre para divergir.
   */
  startRun(args: { tenant: TenantContext; taskType: string; input: unknown }): Promise<{ id: string }>;
  /**
   * Refaz a leitura pelo conector. Chamado só no caminho `fromSource`, e é o
   * que torna a confirmação uma concordância com a leitura em vez de um
   * transporte dela.
   */
  readMeasurement: MeasurementReader;
};

/** Um relatório é mais caro que um metadata; ainda assim, tem teto. */
const READ_TIMEOUT_MS = 20_000;
```

```ts
    // Antes de gravar: se a fonte recusar, não existe medição para registrar, e
    // gravar zero por falta de leitura seria inventar o resultado.
    const reading: ExperimentMeasurement | null = body.fromSource
      ? await deps.readMeasurement(workspaceId, experimentId, AbortSignal.timeout(READ_TIMEOUT_MS))
      : null;

    const value = reading ? reading.value : body.value;
    // Defesa em profundidade: o schema da rota já recusa, e um chamador interno
    // futuro não pode gravar um outcome sem número.
    if (value === undefined) throw new BadRequestError('An outcome needs a value');

    const row = await deps.repo.create(workspaceId, {
      experimentId,
      // Defaults to what the experiment measures: an outcome on a different
      // metric cannot be read against the experiment's baseline and target.
      metric: body.metric ?? experiment.metric,
      value,
      // A unidade informada vence a da fonte: o GA4 Data API não declara
      // unidade por métrica, e quem sabe se aquilo são reais ou chamadas é o
      // fundador.
      unit: body.unit ?? reading?.unit ?? undefined,
      // Deixado como o `observedAt` informado, ou o default da coluna (agora):
      // a leitura foi observada agora, e o período que ela cobre está gravado
      // em `periodStart`/`periodEnd`, não confundido com o instante da leitura.
      observedAt: body.observedAt,
      // Provenance for a hand-entered number. Left explicit rather than relying
      // on the column default so the value is visible where it is decided.
      source: reading ? reading.source : 'USER',
      ...(reading
        ? {
            periodStart: reading.periodStart,
            periodEnd: reading.periodEnd,
            externalRef: reading.externalRef,
            sourceDetail: reading.query as Prisma.InputJsonValue,
          }
        : {}),
    });
```

O resto do serviço (o disparo melhor-esforço de `interpret-outcome` depois de gravar, e o retorno com `presentOutcome`) fica **exatamente como está**.

- [ ] **Step 7: Controller e index**

`back/src/http/api/outcomes/create-outcome/create-outcome.controller.ts` — acrescente os imports, o tipo de opção e a construção do leitor:

```ts
import { createMeasurementReader, type MeasurementReader } from '../../../../measurement/read-measurement.js';

/**
 * O leitor entra por opção de plugin, não por decorator no `app` — mesma razão
 * de `put-integration.controller.ts`: um teste que esquecesse de decorá-lo
 * cairia no leitor real e sairia chamando o Google de dentro da suíte.
 */
export type CreateOutcomeOptions = { read?: MeasurementReader };

export const createOutcomeRoute: FastifyPluginAsync<CreateOutcomeOptions> = async (app, opts) => {
```

e dentro do handler, junto do `startRun`:

```ts
      const readMeasurement = opts.read ?? createMeasurementReader({ prisma: app.prisma });

      const service = createOutcomeService({
        repo: createOutcomesRepository(app.prisma),
        startRun,
        readMeasurement,
      });
```

`back/src/http/api/outcomes/index.ts`:

```ts
import { createOutcomeRoute, type CreateOutcomeOptions } from './create-outcome/create-outcome.controller.js';

/** Registers all `outcomes` routes. Auth, tenant and the read-only guard apply here. */
export const outcomesRoutes: FastifyPluginAsync<CreateOutcomeOptions> = async (app, opts) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.resolveTenant);
  app.addHook('preHandler', app.denyReadOnly);

  await app.register(listOutcomesRoute);
  // O leitor viaja como opção para o teste poder substituí-lo. Sem opção, o
  // leitor real é usado.
  await app.register(createOutcomeRoute, { read: opts.read });
};
```

Não mexa em `src/app.ts`: `outcomesRoutes` registrado sem opções deixa `opts.read` `undefined` e o leitor real é construído.

- [ ] **Step 8: Rode a suíte inteira**

Run: `cd back && pnpm typecheck && pnpm test`
Expected: tsc exit 0; toda a suíte passando. Baseline antes desta parte: **1011 testes / 114 arquivos**. Reporte o número novo.

- [ ] **Step 9: Regenere o contrato**

Run: `cd back && pnpm openapi:dump`
Expected: `../web/api.json` reescrito com `getMeasurementProposal` e o `fromSource` no corpo de `createOutcome`.

- [ ] **Step 10: Stage e mostre o diff (NÃO comite)**

```bash
cd back && git add src/http/api/outcomes && git status --short && git diff --cached --stat
cd ../web && git add api.json && git status --short && git diff --cached --stat
```

Mensagens sugeridas: `feat(outcomes): confirm a measurement read from the source` (back) e `chore(web): regenerate the API contract` (web).

---

## Task 5: Tela de conexão da fonte

**Files:**
- Create: `web/src/pages/IntegrationsPage.tsx`
- Create: `web/src/components/integrations/Ga4ConnectionCard.tsx`
- Create: `web/src/components/integrations/Ga4ConnectionCard.test.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/AppLayout.tsx` (`secondaryNav`, linha 42)
- Modify: `web/src/i18n/locales/en.json`, `pt.json`, `es.json`

**Interfaces:**
- Consumes: hooks gerados `useListIntegrations`, `usePutIntegration`, `useRemoveIntegration`.
- Produces: nada consumido por outras tasks.

- [ ] **Step 1: Gere os hooks e leia as assinaturas reais**

Run: `cd web && pnpm api:generate`

Depois **leia** os arquivos gerados antes de escrever qualquer chamada — os nomes de parâmetro dos hooks de mutação e de query variam com a forma da rota:

```bash
ls src/api/generated/hooks/integrationsHooks/ src/api/generated/hooks/experimentsHooks/
```

Leia `useListIntegrations.ts`, `usePutIntegration.ts`, `useRemoveIntegration.ts` e confirme: o nome exato do hook, a forma do argumento de mutação (`{ data }` vs `{ params, data }`) e o nome da função de query key. Use o que o gerador produziu, não o que este plano supõe.

- [ ] **Step 2: Escreva o teste que falha**

`web/src/components/integrations/Ga4ConnectionCard.test.tsx`:

```tsx
import { describe, expect, it, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/render';
import { stubFetch, type StubFetchCall } from '@/test/stub-fetch';
import { Ga4ConnectionCard } from './Ga4ConnectionCard';

const CONNECTED = {
  id: 'int-1',
  provider: 'GA4',
  authKind: 'SERVICE_ACCOUNT',
  externalId: '123456789',
  accountLabel: 'aurea@project.iam.gserviceaccount.com',
  status: 'OK',
  lastCheckedAt: '2026-08-04T00:00:00.000Z',
  lastError: null,
  createdAt: '2026-08-04T00:00:00.000Z',
};

const CREDENTIAL = '{"client_email":"aurea@project.iam.gserviceaccount.com","private_key":"pk-secret"}';

afterEach(() => vi.unstubAllGlobals());

describe('Ga4ConnectionCard', () => {
  it('mostra o formulário quando nada está conectado', async () => {
    stubFetch({ '/integrations': { body: { integrations: [] } } });

    renderWithProviders(<Ga4ConnectionCard />);

    expect(await screen.findByLabelText(new RegExp(i18n.t('pages.integrations.propertyLabel'), 'i'))).toBeTruthy();
  });

  it('envia a property e a credencial', async () => {
    const calls: StubFetchCall[] = [];
    // Três entradas, e a terceira importa: `stubFetch` indexa por pathname, e
    // o GET que o `invalidateQueries` dispara depois do PUT consumiria a
    // resposta do PUT (sem `integrations`) e derrubaria o render.
    stubFetch(
      {
        '/integrations': [
          { body: { integrations: [] } },
          { body: { integration: CONNECTED } },
          { body: { integrations: [CONNECTED] } },
        ],
      },
      calls,
    );

    renderWithProviders(<Ga4ConnectionCard />);

    await userEvent.type(
      await screen.findByLabelText(new RegExp(i18n.t('pages.integrations.propertyLabel'), 'i')),
      '123456789',
    );
    await userEvent.type(
      screen.getByLabelText(new RegExp(i18n.t('pages.integrations.credentialsLabel'), 'i')),
      CREDENTIAL,
    );
    await userEvent.click(screen.getByRole('button', { name: i18n.t('pages.integrations.connect') }));

    await waitFor(() => {
      const put = calls.find((call) => call.method === 'PUT');
      expect(put?.body).toMatchObject({
        provider: 'GA4',
        authKind: 'SERVICE_ACCOUNT',
        externalId: '123456789',
        credentials: CREDENTIAL,
      });
    });
  });

  it('mostra a conta e o status quando conectado, e nunca o segredo', async () => {
    stubFetch({ '/integrations': { body: { integrations: [CONNECTED] } } });

    const { container } = renderWithProviders(<Ga4ConnectionCard />);

    expect(await screen.findByText('aurea@project.iam.gserviceaccount.com')).toBeTruthy();
    expect(screen.getByText('123456789')).toBeTruthy();
    expect(screen.getByText(i18n.t('pages.integrations.status.OK'))).toBeTruthy();
    // A trava que importa: nenhum caminho da tela renderiza a credencial.
    expect(container.textContent).not.toContain('private_key');
    expect(container.textContent).not.toContain('pk-secret');
  });

  it('mostra a mensagem da própria fonte quando a última verificação falhou', async () => {
    stubFetch({
      '/integrations': {
        body: {
          integrations: [{ ...CONNECTED, status: 'FAILED', lastError: 'Caller does not have permission.' }],
        },
      },
    });

    renderWithProviders(<Ga4ConnectionCard />);

    expect(await screen.findByText(/Caller does not have permission/i)).toBeTruthy();
  });

  it('mostra o motivo quando a fonte recusa a credencial', async () => {
    stubFetch({
      '/integrations': [
        { body: { integrations: [] } },
        { status: 400, body: { error: { code: 'AUR-T0001', message: 'The source refused this credential' } } },
      ],
    });

    renderWithProviders(<Ga4ConnectionCard />);

    await userEvent.type(
      await screen.findByLabelText(new RegExp(i18n.t('pages.integrations.propertyLabel'), 'i')),
      '123456789',
    );
    await userEvent.type(
      screen.getByLabelText(new RegExp(i18n.t('pages.integrations.credentialsLabel'), 'i')),
      CREDENTIAL,
    );
    await userEvent.click(screen.getByRole('button', { name: i18n.t('pages.integrations.connect') }));

    expect(await screen.findByText(/refused this credential/i)).toBeTruthy();
  });

  it('desconecta', async () => {
    const calls: StubFetchCall[] = [];
    stubFetch(
      {
        '/integrations': [
          { body: { integrations: [CONNECTED] } },
          { status: 204, body: {} },
          // O GET que o `invalidateQueries` dispara depois do DELETE.
          { body: { integrations: [] } },
        ],
      },
      calls,
    );

    renderWithProviders(<Ga4ConnectionCard />);

    await userEvent.click(await screen.findByRole('button', { name: i18n.t('pages.integrations.disconnect') }));

    await waitFor(() => expect(calls.some((call) => call.method === 'DELETE')).toBe(true));
  });
});
```

- [ ] **Step 3: Rode e confirme que falha**

Run: `cd web && pnpm vitest run src/components/integrations`
Expected: FAIL — `Failed to resolve import "./Ga4ConnectionCard"`.

- [ ] **Step 4: i18n nas três línguas**

`web/src/i18n/locales/en.json` — em `app.nav`, acrescente `"integrations": "Data sources"`. E, no topo de `pages`, um bloco novo:

```json
    "integrations": {
      "title": "Data sources",
      "subtitle": "Where AUREA reads your numbers from.",
      "helpTitle": "Data source",
      "help": "A system that already measures your business — Google Analytics today. AUREA reads numbers from it; it never writes to it.",
      "propertyLabel": "GA4 property ID",
      "propertyHelpTitle": "Property",
      "propertyHelp": "The numeric ID of the Google Analytics property, as it appears in Admin → Property settings. Not the measurement ID that starts with G-.",
      "credentialsLabel": "Service account key (JSON)",
      "credentialsHelpTitle": "Service account",
      "credentialsHelp": "A Google account that belongs to a program, not a person. Create one, add it as a Viewer of the property, and paste its JSON key here. AUREA stores it encrypted and only ever asks for read access.",
      "connect": "Connect",
      "connecting": "Connecting…",
      "connected": "Connected",
      "disconnect": "Disconnect",
      "empty": "No data source connected. Until one is, every measurement is typed in by hand.",
      "account": "Account",
      "property": "Property",
      "lastChecked": "Last checked",
      "connectFailed": "Could not connect this source.",
      "status": {
        "UNVERIFIED": "Not verified yet",
        "OK": "Working",
        "FAILED": "Not working"
      }
    },
```

`pt.json` (mesmas chaves):

```json
    "integrations": {
      "title": "Fontes de dados",
      "subtitle": "De onde a AUREA lê os seus números.",
      "helpTitle": "Fonte de dados",
      "help": "Um sistema que já mede o seu negócio — hoje, o Google Analytics. A AUREA lê números dele; nunca escreve nele.",
      "propertyLabel": "ID da property do GA4",
      "propertyHelpTitle": "Property",
      "propertyHelp": "O ID numérico da property do Google Analytics, como aparece em Administrador → Configurações da property. Não é o ID de métrica que começa com G-.",
      "credentialsLabel": "Chave da service account (JSON)",
      "credentialsHelpTitle": "Service account",
      "credentialsHelp": "Uma conta Google que pertence a um programa, não a uma pessoa. Crie uma, adicione como leitora da property e cole a chave JSON aqui. A AUREA guarda cifrada e só pede acesso de leitura.",
      "connect": "Conectar",
      "connecting": "Conectando…",
      "connected": "Conectada",
      "disconnect": "Desconectar",
      "empty": "Nenhuma fonte conectada. Enquanto não houver, cada medição é digitada à mão.",
      "account": "Conta",
      "property": "Property",
      "lastChecked": "Última verificação",
      "connectFailed": "Não foi possível conectar esta fonte.",
      "status": {
        "UNVERIFIED": "Ainda não verificada",
        "OK": "Funcionando",
        "FAILED": "Com problema"
      }
    },
```

`es.json`:

```json
    "integrations": {
      "title": "Fuentes de datos",
      "subtitle": "De dónde AUREA lee tus números.",
      "helpTitle": "Fuente de datos",
      "help": "Un sistema que ya mide tu negocio — hoy, Google Analytics. AUREA lee números de él; nunca escribe en él.",
      "propertyLabel": "ID de la propiedad de GA4",
      "propertyHelpTitle": "Propiedad",
      "propertyHelp": "El ID numérico de la propiedad de Google Analytics, como aparece en Administrador → Configuración de la propiedad. No es el ID de medición que empieza con G-.",
      "credentialsLabel": "Clave de la cuenta de servicio (JSON)",
      "credentialsHelpTitle": "Cuenta de servicio",
      "credentialsHelp": "Una cuenta de Google que pertenece a un programa, no a una persona. Crea una, añádela como lectora de la propiedad y pega su clave JSON aquí. AUREA la guarda cifrada y solo pide acceso de lectura.",
      "connect": "Conectar",
      "connecting": "Conectando…",
      "connected": "Conectada",
      "disconnect": "Desconectar",
      "empty": "Ninguna fuente conectada. Mientras no haya una, cada medición se escribe a mano.",
      "account": "Cuenta",
      "property": "Propiedad",
      "lastChecked": "Última verificación",
      "connectFailed": "No se pudo conectar esta fuente.",
      "status": {
        "UNVERIFIED": "Aún sin verificar",
        "OK": "Funcionando",
        "FAILED": "Con problema"
      }
    },
```

E `app.nav.integrations`: `"Fontes de dados"` (pt) e `"Fuentes de datos"` (es).

- [ ] **Step 5: O card**

`web/src/components/integrations/Ga4ConnectionCard.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListIntegrations,
  listIntegrationsQueryKey,
} from '@/api/generated/hooks/integrationsHooks/useListIntegrations';
import { usePutIntegration } from '@/api/generated/hooks/integrationsHooks/usePutIntegration';
import { useRemoveIntegration } from '@/api/generated/hooks/integrationsHooks/useRemoveIntegration';
import { apiErrorMessage } from '@/lib/api-errors';
import { Help } from '@/components/Help';
import { SectionLoading, SectionLoadError } from '@/components/SectionState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TextField } from '@/components/form/TextField';
import { TextareaField } from '@/components/form/TextareaField';

const PROVIDER = 'GA4';

/**
 * Conectar, ver o estado, desconectar.
 *
 * A credencial só viaja para cima: ela é enviada uma vez e nunca volta em
 * resposta nenhuma (o servidor a exclui por `select`, não por confiança), então
 * não existe caminho nesta tela que a mostre de novo — nem em campo
 * preenchido, nem em texto de status.
 */
export function Ga4ConnectionCard() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [propertyId, setPropertyId] = useState('');
  const [credentials, setCredentials] = useState('');
  const [error, setError] = useState<string | null>(null);

  const integrations = useListIntegrations();
  const connected = integrations.data?.integrations.find((row) => row.provider === PROVIDER) ?? null;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: listIntegrationsQueryKey() });

  const connect = usePutIntegration({
    mutation: {
      onMutate: () => setError(null),
      onSuccess: async () => {
        // Limpo assim que a gravação passa: um textarea que continua com o JSON
        // da chave é o segredo em tela por tempo indefinido.
        setCredentials('');
        setPropertyId('');
        await invalidate();
      },
      onError: (err) => setError(apiErrorMessage(err, t('pages.integrations.connectFailed'))),
    },
  });

  const disconnect = useRemoveIntegration({
    mutation: {
      onMutate: () => setError(null),
      onSuccess: async () => await invalidate(),
      onError: (err) => setError(apiErrorMessage(err, t('pages.integrations.connectFailed'))),
    },
  });

  const formatDate = (value: Date | string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <p className="text-sm font-medium">
          Google Analytics 4
          <Help title={t('pages.integrations.helpTitle')}>{t('pages.integrations.help')}</Help>
        </p>

        {integrations.isLoading && <SectionLoading />}
        {(integrations.isError || (!integrations.isLoading && !integrations.data)) && (
          <SectionLoadError refetch={[integrations.refetch]} />
        )}

        {integrations.data && connected && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="muted">{t(`pages.integrations.status.${connected.status}`)}</Badge>
              {connected.lastCheckedAt && (
                <span className="text-xs text-muted-foreground">
                  {t('pages.integrations.lastChecked')}: {formatDate(connected.lastCheckedAt)}
                </span>
              )}
            </div>
            <div>
              <p className="text-sm font-medium">{t('pages.integrations.account')}</p>
              <p className="text-sm text-muted-foreground">{connected.accountLabel}</p>
            </div>
            <div>
              <p className="text-sm font-medium">{t('pages.integrations.property')}</p>
              <p className="font-mono text-sm text-muted-foreground">{connected.externalId}</p>
            </div>
            {/* A mensagem da própria fonte, quando ela deu uma: "Caller does not
                have permission" diz ao fundador o que fazer. */}
            {connected.lastError && <p className="text-sm text-destructive">{connected.lastError}</p>}
            <Button
              size="sm"
              variant="outline"
              disabled={disconnect.isPending}
              onClick={() => disconnect.mutate({ params: { provider: PROVIDER } })}
            >
              {t('pages.integrations.disconnect')}
            </Button>
          </div>
        )}

        {integrations.data && !connected && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('pages.integrations.empty')}</p>
            <TextField
              htmlFor="ga4-property"
              label={t('pages.integrations.propertyLabel')}
              helpTitle={t('pages.integrations.propertyHelpTitle')}
              help={t('pages.integrations.propertyHelp')}
              value={propertyId}
              onChange={setPropertyId}
            />
            <TextareaField
              htmlFor="ga4-credentials"
              label={t('pages.integrations.credentialsLabel')}
              helpTitle={t('pages.integrations.credentialsHelpTitle')}
              help={t('pages.integrations.credentialsHelp')}
              value={credentials}
              onChange={setCredentials}
            />
            <Button
              size="sm"
              disabled={connect.isPending || propertyId.trim() === '' || credentials.trim() === ''}
              onClick={() =>
                connect.mutate({
                  data: {
                    provider: PROVIDER,
                    authKind: 'SERVICE_ACCOUNT',
                    externalId: propertyId.trim(),
                    credentials,
                  },
                })
              }
            >
              {connect.isPending ? t('pages.integrations.connecting') : t('pages.integrations.connect')}
            </Button>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
```

**Antes de escrever isto:** confirme que `web/src/components/form/TextareaField.tsx` existe e qual é a sua prop de mudança (`onChange(value: string)` como `TextField`, ou `onChange(event)`). Se não existir um campo de textarea no diretório `form/`, use `TextField` com o mesmo `label`/`help` — o JSON cabe num input, e inventar um primitivo novo não é escopo desta task. Ajuste o teste (`getByLabelText`) se o rótulo mudar.

- [ ] **Step 6: Página, rota e navegação**

`web/src/pages/IntegrationsPage.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/PageHeader';
import { Help } from '@/components/Help';
import { Ga4ConnectionCard } from '@/components/integrations/Ga4ConnectionCard';

// Sem `LoopRail`: conectar uma fonte é configuração, não uma etapa do loop.
export function IntegrationsPage() {
  const { t } = useTranslation();

  return (
    <div>
      <PageHeader
        eyebrow={t('app.nav.integrations')}
        title={t('pages.integrations.title')}
        help={<Help title={t('pages.integrations.helpTitle')}>{t('pages.integrations.help')}</Help>}
        subtitle={t('pages.integrations.subtitle')}
      />
      <Ga4ConnectionCard />
    </div>
  );
}
```

`web/src/App.tsx` — import e rota, ao lado da de billing:

```tsx
import { IntegrationsPage } from './pages/IntegrationsPage';
```
```tsx
      <Route path="/app/settings/integrations" element={<Protected><IntegrationsPage /></Protected>} />
```

`web/src/components/AppLayout.tsx` — acrescente `PlugZap` ao import de `lucide-react` e a entrada:

```ts
const secondaryNav = [
  { to: '/app/settings/billing', key: 'billing', icon: CreditCard },
  { to: '/app/settings/integrations', key: 'integrations', icon: PlugZap },
];
```

- [ ] **Step 7: Rode os testes**

Run: `cd web && pnpm vitest run src/components/integrations src/i18n && pnpm typecheck`
Expected: PASS (inclusive `locales.test.ts`), tsc exit 0.

- [ ] **Step 8: Stage e mostre o diff (NÃO comite)**

```bash
cd web && git add src/pages/IntegrationsPage.tsx src/components/integrations src/App.tsx src/components/AppLayout.tsx src/i18n src/api/generated
git status --short && git diff --cached --stat
```

Mensagem sugerida: `feat(web): connect a GA4 property`

---

## Task 6: Amarração da métrica, com assistência de IA

**Files:**
- Create: `web/src/schemas/metric-binding.ts`
- Create: `web/src/components/experiments/MetricBindingCard.tsx`
- Create: `web/src/components/experiments/MetricBindingCard.test.tsx`
- Modify: `web/src/pages/ExperimentDetailPage.tsx`
- Modify: `web/src/i18n/locales/en.json`, `pt.json`, `es.json`

**Interfaces:**
- Consumes: hooks gerados `useGetMetricBinding`, `usePutMetricBinding`, `useRemoveMetricBinding`; `useFillRun` de `@/components/ai/useFillRun`; `parseRunExperimentId` de `@/schemas/interpret-outcome`.
- Produces: `proposeMetricBindingOutput` e `metricBindingFormSchema` em `@/schemas/metric-binding`; `<MetricBindingCard experimentId={id} />`.

- [ ] **Step 1: Escreva o teste que falha**

`web/src/components/experiments/MetricBindingCard.test.tsx`:

```tsx
import { describe, expect, it, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/render';
import { stubFetch, type StubFetchCall } from '@/test/stub-fetch';
import { MetricBindingCard } from './MetricBindingCard';

const EXPERIMENT_ID = '11111111-1111-1111-1111-111111111111';
const RUN_ID = '99999999-9999-9999-9999-999999999999';

const BINDING = {
  id: 'mb-1',
  experimentId: EXPERIMENT_ID,
  provider: 'GA4',
  config: { metric: 'conversions', dimensionFilter: { fieldName: 'eventName', value: 'sign_up' } },
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z',
};

const PRICING = { operations: [{ taskType: 'propose-metric-binding', credits: 1 }] };
const CREDITS = { balance: 40, granted: 40, used: 0 };

const bindingPath = `/experiments/${EXPERIMENT_ID}/metric-binding`;

/** O run que a recuperação de `useFillRun` encontra, com a saída do agente. */
const completedRun = (output: unknown) => ({
  id: RUN_ID,
  taskType: 'propose-metric-binding',
  status: 'COMPLETED',
  input: { experimentId: EXPERIMENT_ID },
  output,
  error: null,
  createdAt: '2026-08-04T00:00:00.000Z',
});

afterEach(() => vi.unstubAllGlobals());

describe('MetricBindingCard', () => {
  it('oferece o formulário quando não há amarração', async () => {
    stubFetch({
      [bindingPath]: { status: 404, body: { error: { code: 'AUR-T0005' } } },
      '/credits': { body: CREDITS },
      '/credits/pricing': { body: PRICING },
      '/agent-runs': { body: { runs: [] } },
      '/integrations': { body: { integrations: [{ provider: 'GA4', status: 'OK' }] } },
    });

    renderWithProviders(<MetricBindingCard experimentId={EXPERIMENT_ID} />);

    expect(await screen.findByLabelText(new RegExp(i18n.t('pages.experiments.binding.metricLabel'), 'i'))).toBeTruthy();
    // Preço na tela antes do clique, como em todos os outros botões de IA.
    expect(screen.getByText(i18n.t('ai.fill.cost', { credits: 1 }))).toBeTruthy();
  });

  it('mostra a amarração existente', async () => {
    stubFetch({
      [bindingPath]: { body: { binding: BINDING } },
      '/credits': { body: CREDITS },
      '/credits/pricing': { body: PRICING },
      '/agent-runs': { body: { runs: [] } },
      '/integrations': { body: { integrations: [{ provider: 'GA4', status: 'OK' }] } },
    });

    renderWithProviders(<MetricBindingCard experimentId={EXPERIMENT_ID} />);

    expect(await screen.findByText('conversions')).toBeTruthy();
    expect(screen.getByText(/eventName/)).toBeTruthy();
  });

  it('preenche os campos com a proposta da IA, e mostra o motivo', async () => {
    stubFetch({
      [bindingPath]: { status: 404, body: { error: { code: 'AUR-T0005' } } },
      '/credits': { body: CREDITS },
      '/credits/pricing': { body: PRICING },
      '/agent-runs': {
        body: {
          runs: [
            completedRun({
              binding: { metric: 'conversions', dimensionFilter: { fieldName: 'eventName', value: 'sign_up' } },
              rationale: 'conversions filtered to sign_up is what this experiment measures.',
            }),
          ],
        },
      },
      [`/agent-runs/${RUN_ID}`]: {
        body: completedRun({
          binding: { metric: 'conversions', dimensionFilter: { fieldName: 'eventName', value: 'sign_up' } },
          rationale: 'conversions filtered to sign_up is what this experiment measures.',
        }),
      },
      '/integrations': { body: { integrations: [{ provider: 'GA4', status: 'OK' }] } },
    });

    renderWithProviders(<MetricBindingCard experimentId={EXPERIMENT_ID} />);

    const metric = (await screen.findByLabelText(
      new RegExp(i18n.t('pages.experiments.binding.metricLabel'), 'i'),
    )) as HTMLInputElement;
    await waitFor(() => expect(metric.value).toBe('conversions'));
    expect(screen.getByText(/is what this experiment measures/)).toBeTruthy();
  });

  // A trava do spec §6: nenhuma métrica plausível devolve vazio com o motivo. A
  // tela não pode preencher nada — uma amarração errada erra todos os números
  // daquele experimento para sempre.
  it('não preenche nada quando o agente diz que nenhuma métrica serve', async () => {
    const output = { binding: null, rationale: 'This property has no metric for booked calls; it lives in your CRM.' };
    stubFetch({
      [bindingPath]: { status: 404, body: { error: { code: 'AUR-T0005' } } },
      '/credits': { body: CREDITS },
      '/credits/pricing': { body: PRICING },
      '/agent-runs': { body: { runs: [completedRun(output)] } },
      [`/agent-runs/${RUN_ID}`]: { body: completedRun(output) },
      '/integrations': { body: { integrations: [{ provider: 'GA4', status: 'OK' }] } },
    });

    renderWithProviders(<MetricBindingCard experimentId={EXPERIMENT_ID} />);

    expect(await screen.findByText(/lives in your CRM/)).toBeTruthy();
    expect(screen.getByText(i18n.t('pages.experiments.binding.aiNothingFits'))).toBeTruthy();
    const metric = screen.getByLabelText(
      new RegExp(i18n.t('pages.experiments.binding.metricLabel'), 'i'),
    ) as HTMLInputElement;
    expect(metric.value).toBe('');
  });

  it('salva com dimensionFilter nulo quando os campos de filtro estão vazios', async () => {
    const calls: StubFetchCall[] = [];
    stubFetch(
      {
        [bindingPath]: [
          { status: 404, body: { error: { code: 'AUR-T0005' } } },
          { body: { binding: BINDING } },
        ],
        '/credits': { body: CREDITS },
        '/credits/pricing': { body: PRICING },
        '/agent-runs': { body: { runs: [] } },
        '/integrations': { body: { integrations: [{ provider: 'GA4', status: 'OK' }] } },
      },
      calls,
    );

    renderWithProviders(<MetricBindingCard experimentId={EXPERIMENT_ID} />);

    await userEvent.type(
      await screen.findByLabelText(new RegExp(i18n.t('pages.experiments.binding.metricLabel'), 'i')),
      'conversions',
    );
    await userEvent.click(screen.getByRole('button', { name: i18n.t('pages.experiments.binding.save') }));

    await waitFor(() => {
      const put = calls.find((call) => call.method === 'PUT');
      expect(put?.body).toMatchObject({ provider: 'GA4', config: { metric: 'conversions', dimensionFilter: null } });
    });
  });

  it('pede a conexão da fonte em vez de oferecer a IA quando nada está conectado', async () => {
    stubFetch({
      [bindingPath]: { status: 404, body: { error: { code: 'AUR-T0005' } } },
      '/credits': { body: CREDITS },
      '/credits/pricing': { body: PRICING },
      '/agent-runs': { body: { runs: [] } },
      '/integrations': { body: { integrations: [] } },
    });

    renderWithProviders(<MetricBindingCard experimentId={EXPERIMENT_ID} />);

    expect(await screen.findByText(i18n.t('pages.experiments.binding.notConnected'))).toBeTruthy();
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `cd web && pnpm vitest run src/components/experiments/MetricBindingCard.test.tsx`
Expected: FAIL — `Failed to resolve import "./MetricBindingCard"`.

- [ ] **Step 3: i18n**

Em `web/src/i18n/locales/en.json`, dentro de `pages.experiments`, acrescente:

```json
      "binding": {
        "title": "Where this number comes from",
        "helpTitle": "Metric binding",
        "help": "Which metric of your data source answers for this experiment's metric. Your metric name is your own words; this is the name the source understands. Without a binding, you keep typing the number in by hand — nothing breaks.",
        "metricLabel": "Source metric",
        "metricHelpTitle": "Source metric",
        "metricHelp": "The technical name the source uses, like `conversions` or `activeUsers`. It has to be one the property actually has.",
        "filterFieldLabel": "Filter field",
        "filterValueLabel": "Filter value",
        "filterHelpTitle": "Filter",
        "filterHelp": "Optional. Narrows the metric to part of what it counts — for example the field `eventName` with the value `sign_up`, so only sign-ups are counted.",
        "save": "Save binding",
        "remove": "Remove binding",
        "bound": "Bound to",
        "filteredBy": "filtered by",
        "aiLabel": "Ask AUREA which metric fits",
        "aiNothingFits": "AUREA found no metric in this property that answers for this experiment. Nothing was filled in.",
        "aiRationale": "Why",
        "metricRequired": "Name the source metric.",
        "bothFilterFields": "Fill both filter fields, or neither.",
        "saveFailed": "Could not save this binding.",
        "notConnected": "No data source is connected yet.",
        "connectLink": "Connect one"
      },
```

`pt.json`:

```json
      "binding": {
        "title": "De onde vem este número",
        "helpTitle": "Amarração da métrica",
        "help": "Qual métrica da sua fonte de dados responde pela métrica deste experimento. O nome que você escreveu é seu; este é o nome que a fonte entende. Sem amarração, você continua digitando o número à mão — nada quebra.",
        "metricLabel": "Métrica da fonte",
        "metricHelpTitle": "Métrica da fonte",
        "metricHelp": "O nome técnico que a fonte usa, como `conversions` ou `activeUsers`. Tem que ser um que a property realmente tenha.",
        "filterFieldLabel": "Campo do filtro",
        "filterValueLabel": "Valor do filtro",
        "filterHelpTitle": "Filtro",
        "filterHelp": "Opcional. Restringe a métrica a uma parte do que ela conta — por exemplo o campo `eventName` com o valor `sign_up`, para contar só os cadastros.",
        "save": "Salvar amarração",
        "remove": "Remover amarração",
        "bound": "Amarrada a",
        "filteredBy": "filtrada por",
        "aiLabel": "Perguntar à AUREA qual métrica serve",
        "aiNothingFits": "A AUREA não achou nesta property nenhuma métrica que responda por este experimento. Nada foi preenchido.",
        "aiRationale": "Por quê",
        "metricRequired": "Diga qual é a métrica da fonte.",
        "bothFilterFields": "Preencha os dois campos do filtro, ou nenhum.",
        "saveFailed": "Não foi possível salvar esta amarração.",
        "notConnected": "Nenhuma fonte de dados está conectada ainda.",
        "connectLink": "Conectar uma"
      },
```

`es.json`:

```json
      "binding": {
        "title": "De dónde viene este número",
        "helpTitle": "Vinculación de la métrica",
        "help": "Qué métrica de tu fuente de datos responde por la métrica de este experimento. El nombre que escribiste es tuyo; este es el nombre que la fuente entiende. Sin vinculación, sigues escribiendo el número a mano — nada se rompe.",
        "metricLabel": "Métrica de la fuente",
        "metricHelpTitle": "Métrica de la fuente",
        "metricHelp": "El nombre técnico que usa la fuente, como `conversions` o `activeUsers`. Tiene que ser uno que la propiedad realmente tenga.",
        "filterFieldLabel": "Campo del filtro",
        "filterValueLabel": "Valor del filtro",
        "filterHelpTitle": "Filtro",
        "filterHelp": "Opcional. Restringe la métrica a una parte de lo que cuenta — por ejemplo el campo `eventName` con el valor `sign_up`, para contar solo los registros.",
        "save": "Guardar vinculación",
        "remove": "Quitar vinculación",
        "bound": "Vinculada a",
        "filteredBy": "filtrada por",
        "aiLabel": "Preguntar a AUREA qué métrica sirve",
        "aiNothingFits": "AUREA no encontró en esta propiedad ninguna métrica que responda por este experimento. No se rellenó nada.",
        "aiRationale": "Por qué",
        "metricRequired": "Di cuál es la métrica de la fuente.",
        "bothFilterFields": "Rellena los dos campos del filtro, o ninguno.",
        "saveFailed": "No se pudo guardar esta vinculación.",
        "notConnected": "Ninguna fuente de datos está conectada todavía.",
        "connectLink": "Conectar una"
      },
```

- [ ] **Step 4: Schemas**

`web/src/schemas/metric-binding.ts`:

```ts
import { z } from 'zod';

/**
 * A saída do agente `propose-metric-binding`, validada antes de tocar o
 * formulário. `binding: null` é resposta, não falha: o agente devolve vazio com
 * o motivo em vez de escolher a métrica mais parecida.
 */
export const proposeMetricBindingOutput = z.object({
  binding: z
    .object({
      metric: z.string().min(1),
      dimensionFilter: z
        .object({ fieldName: z.string().min(1), value: z.string().min(1) })
        .nullish(),
    })
    .nullable(),
  rationale: z.string().min(1),
});

export type ProposeMetricBindingOutput = z.infer<typeof proposeMetricBindingOutput>;

/** Os dois campos do filtro andam juntos: metade de um filtro não é um filtro. */
export const metricBindingFormSchema = z
  .object({
    metric: z.string().trim().min(1, 'pages.experiments.binding.metricRequired'),
    filterField: z.string().trim().optional(),
    filterValue: z.string().trim().optional(),
  })
  .refine((values) => Boolean(values.filterField) === Boolean(values.filterValue), {
    message: 'pages.experiments.binding.bothFilterFields',
    path: ['filterValue'],
  });

export type MetricBindingFormValues = z.infer<typeof metricBindingFormSchema>;
```

- [ ] **Step 5: O card**

`web/src/components/experiments/MetricBindingCard.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Sparkles } from 'lucide-react';
import {
  useGetMetricBinding,
  getMetricBindingQueryKey,
} from '@/api/generated/hooks/experimentsHooks/useGetMetricBinding';
import { usePutMetricBinding } from '@/api/generated/hooks/experimentsHooks/usePutMetricBinding';
import { useRemoveMetricBinding } from '@/api/generated/hooks/experimentsHooks/useRemoveMetricBinding';
import { useListIntegrations } from '@/api/generated/hooks/integrationsHooks/useListIntegrations';
import { useFillRun } from '@/components/ai/useFillRun';
import { SpecialistByline } from '@/components/ai/SpecialistByline';
import { RunningRunCard } from '@/components/ai/RunningRunCard';
import { parseRunExperimentId } from '@/schemas/interpret-outcome';
import { metricBindingFormSchema, proposeMetricBindingOutput, type MetricBindingFormValues } from '@/schemas/metric-binding';
import { apiErrorMessage } from '@/lib/api-errors';
import { availableCredits } from '@/lib/credits';
import { useGetCredits } from '@/api/generated/hooks/creditsHooks/useGetCredits';
import { useGetCreditPricing } from '@/api/generated/hooks/creditsHooks/useGetCreditPricing';
import { Help } from '@/components/Help';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TextField } from '@/components/form/TextField';

const TASK_TYPE = 'propose-metric-binding';

/**
 * A amarração: qual métrica da fonte responde por este experimento.
 *
 * O agente propõe, o fundador confirma — sempre. A amarração é proveniência, e
 * proveniência não se infere: uma amarração errada não erra um formulário, erra
 * todos os números daquele experimento para sempre, e o erro chega disfarçado
 * de dado (spec §6).
 */
export function MetricBindingCard({ experimentId }: { experimentId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [saveError, setSaveError] = useState<string | null>(null);

  const binding = useGetMetricBinding(experimentId, { query: { retry: false } });
  const integrations = useListIntegrations();
  const credits = useGetCredits();
  const pricing = useGetCreditPricing();

  const connected = integrations.data?.integrations.some((row) => row.provider === 'GA4') ?? false;
  const cost = pricing.data?.operations.find((operation) => operation.taskType === TASK_TYPE)?.credits ?? null;
  const balance = credits.data ? availableCredits(credits.data) : null;
  // Orientação, não autorização: enquanto preço ou saldo não resolveram, não
  // bloqueia quem tem saldo.
  const short = cost !== null && balance !== null && balance < cost;

  const current = binding.data?.binding ?? null;
  const config = proposeMetricBindingOutput.shape.binding.safeParse(current?.config ?? null);
  const bound = config.success ? config.data : null;

  const { control, handleSubmit, setValue } = useForm<MetricBindingFormValues>({
    resolver: zodResolver(metricBindingFormSchema),
    defaultValues: { metric: '', filterField: '', filterValue: '' },
  });

  const run = useFillRun({
    taskType: TASK_TYPE,
    input: { experimentId },
    // Um run adotado tem que ser deste experimento: o mais recente do workspace
    // pode ser de outro, e aplicá-lo amarraria a métrica errada.
    matchesInput: (input) => parseRunExperimentId(input) === experimentId,
    startFailedMessage: t('ai.fill.startFailed'),
  });

  const proposal = run.state === 'done' ? proposeMetricBindingOutput.safeParse(run.output) : null;
  // Guardado pelo id do run: sem isto, cada render sobrescreveria o que o
  // fundador editou depois de a proposta chegar.
  const applied = useRef<string | null>(null);

  useEffect(() => {
    if (!proposal?.success || !run.runId || applied.current === run.runId) return;
    applied.current = run.runId;
    // `binding: null` não preenche nada. A tela mostra o motivo e para aí.
    const proposed = proposal.data.binding;
    if (!proposed) return;
    setValue('metric', proposed.metric);
    setValue('filterField', proposed.dimensionFilter?.fieldName ?? '');
    setValue('filterValue', proposed.dimensionFilter?.value ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.runId, proposal?.success]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getMetricBindingQueryKey(experimentId) });

  const save = usePutMetricBinding({
    mutation: {
      onMutate: () => setSaveError(null),
      onSuccess: async () => await invalidate(),
      onError: (error) => setSaveError(apiErrorMessage(error, t('pages.experiments.binding.saveFailed'))),
    },
  });

  const remove = useRemoveMetricBinding({
    mutation: {
      onMutate: () => setSaveError(null),
      onSuccess: async () => await invalidate(),
      onError: (error) => setSaveError(apiErrorMessage(error, t('pages.experiments.binding.saveFailed'))),
    },
  });

  const onSubmit = handleSubmit((values) => {
    save.mutate({
      id: experimentId,
      data: {
        provider: 'GA4',
        config: {
          metric: values.metric,
          dimensionFilter:
            values.filterField && values.filterValue
              ? { fieldName: values.filterField, value: values.filterValue }
              : null,
        },
      },
    });
  });

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <p className="text-sm font-medium">
          {t('pages.experiments.binding.title')}
          <Help title={t('pages.experiments.binding.helpTitle')}>{t('pages.experiments.binding.help')}</Help>
        </p>

        {bound && (
          <div className="space-y-2 border-l-2 border-primary/40 pl-3">
            <p className="text-sm">
              {t('pages.experiments.binding.bound')} <span className="font-mono">{bound.metric}</span>
            </p>
            {bound.dimensionFilter && (
              <p className="text-sm text-muted-foreground">
                {t('pages.experiments.binding.filteredBy')}{' '}
                <span className="font-mono">
                  {bound.dimensionFilter.fieldName} = {bound.dimensionFilter.value}
                </span>
              </p>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ id: experimentId })}
            >
              {t('pages.experiments.binding.remove')}
            </Button>
          </div>
        )}

        {/* O bloco de IA. Sem fonte conectada não há o que propor, e o botão
            cinza sem explicação é a versão de UI de um erro sem mensagem. */}
        {!connected ? (
          <p className="text-sm text-muted-foreground">
            {t('pages.experiments.binding.notConnected')}{' '}
            <Link to="/app/settings/integrations" className="underline">
              {t('pages.experiments.binding.connectLink')}
            </Link>
          </p>
        ) : run.state === 'starting' ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> {t('ai.fill.thinking')}
          </p>
        ) : run.state === 'running' ? (
          <RunningRunCard
            startedAt={run.startedAt}
            isForeign={run.isForeign}
            onCancel={run.cancel}
            isCancelling={run.isCancelling}
          />
        ) : (
          <div className="space-y-2">
            <SpecialistByline specialist="analyst" />
            {run.error && <p className="text-sm text-destructive">{run.error}</p>}
            <Button size="sm" className="gap-2" disabled={short || run.isStarting} onClick={run.start}>
              <Sparkles className="size-4" /> {t('pages.experiments.binding.aiLabel')}
            </Button>
            {cost !== null && <p className="text-xs text-muted-foreground">{t('ai.fill.cost', { credits: cost })}</p>}
            {short && <p className="text-sm text-destructive">{t('ai.fill.short')}</p>}
          </div>
        )}

        {proposal?.success && (
          <div className="space-y-1 rounded-md border p-3">
            {/* Nenhuma métrica plausível: o motivo, e nada preenchido. */}
            {!proposal.data.binding && (
              <p className="text-sm font-medium">{t('pages.experiments.binding.aiNothingFits')}</p>
            )}
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('pages.experiments.binding.aiRationale')}
            </p>
            <p className="text-sm text-muted-foreground">{proposal.data.rationale}</p>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4 border-t pt-4">
          <Controller
            control={control}
            name="metric"
            render={({ field, fieldState }) => (
              <TextField
                htmlFor="binding-metric"
                label={t('pages.experiments.binding.metricLabel')}
                helpTitle={t('pages.experiments.binding.metricHelpTitle')}
                help={t('pages.experiments.binding.metricHelp')}
                value={field.value}
                onChange={field.onChange}
                error={fieldState.error?.message ? t(fieldState.error.message) : undefined}
              />
            )}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={control}
              name="filterField"
              render={({ field, fieldState }) => (
                <TextField
                  htmlFor="binding-filter-field"
                  label={t('pages.experiments.binding.filterFieldLabel')}
                  helpTitle={t('pages.experiments.binding.filterHelpTitle')}
                  help={t('pages.experiments.binding.filterHelp')}
                  optional
                  optionalLabel={t('common.optional')}
                  value={field.value}
                  onChange={field.onChange}
                  error={fieldState.error?.message ? t(fieldState.error.message) : undefined}
                />
              )}
            />
            <Controller
              control={control}
              name="filterValue"
              render={({ field, fieldState }) => (
                <TextField
                  htmlFor="binding-filter-value"
                  label={t('pages.experiments.binding.filterValueLabel')}
                  optional
                  optionalLabel={t('common.optional')}
                  value={field.value}
                  onChange={field.onChange}
                  error={fieldState.error?.message ? t(fieldState.error.message) : undefined}
                />
              )}
            />
          </div>

          {saveError && <p className="text-sm text-destructive">{saveError}</p>}

          <Button type="submit" size="sm" disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('pages.experiments.binding.save')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

Notas de implementação que você tem de conferir contra o código gerado e existente:
- `useGetMetricBinding` precisa de `retry: false` para o 404 (sem amarração) resolver como erro rápido em vez de retentar; confirme o nome da opção na assinatura gerada (`{ query: { ... } }`).
- `proposeMetricBindingOutput.shape.binding` é reutilizado para validar o `config` que veio do servidor. Se o `.shape` não estiver acessível pelo tipo (`config: z.unknown()` no contrato), extraia o objeto para uma const exportada (`bindingConfigSchema`) em `@/schemas/metric-binding` e use-a nos dois lugares.
- `SpecialistByline` exige um `specialist` conhecido; confirme em `SpecialistByline.tsx` que `'analyst'` é um valor válido (é o `agentType` do agente).

- [ ] **Step 6: Monte na página**

`web/src/pages/ExperimentDetailPage.tsx` — import e montagem na coluna da direita, acima de `OutcomeInterpretation`:

```tsx
import { MetricBindingCard } from '@/components/experiments/MetricBindingCard';
```
```tsx
        <div className="space-y-4">
          <MetricBindingCard experimentId={id} />
          <OutcomeInterpretation
```

- [ ] **Step 7: Rode os testes**

Run: `cd web && pnpm vitest run src/components/experiments src/pages/ExperimentDetailPage.test.tsx src/i18n && pnpm typecheck`
Expected: PASS. Se `ExperimentDetailPage.test.tsx` quebrar por rota não stubada (`/experiments/:id/metric-binding`, `/integrations`), acrescente as rotas ao `stubFetch` daquele arquivo — o teste da página precisa dizer o que a página busca.

- [ ] **Step 8: Stage e mostre o diff (NÃO comite)**

```bash
cd web && git add src/schemas/metric-binding.ts src/components/experiments src/pages/ExperimentDetailPage.tsx src/i18n
git status --short && git diff --cached --stat
```

Mensagem sugerida: `feat(web): bind an experiment to a source metric, with AI help`

---

## Task 7: Proposta de medição e confirmação

**Files:**
- Create: `web/src/components/experiments/MeasurementProposalCard.tsx`
- Create: `web/src/components/experiments/MeasurementProposalCard.test.tsx`
- Modify: `web/src/pages/ExperimentDetailPage.tsx`
- Modify: `web/src/i18n/locales/en.json`, `pt.json`, `es.json`

**Interfaces:**
- Consumes: hook gerado `useGetMeasurementProposal`; `useGetMetricBinding`; `useCreateOutcome` com `{ data: { fromSource: true } }`; `listOutcomesQueryKey`, `getExperimentQueryKey`.
- Produces: `<MeasurementProposalCard experimentId={id} canMeasure={boolean} onInterpretationStarted={fn} />`.

- [ ] **Step 1: Escreva o teste que falha**

`web/src/components/experiments/MeasurementProposalCard.test.tsx`:

```tsx
import { describe, expect, it, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/render';
import { stubFetch, type StubFetchCall } from '@/test/stub-fetch';
import { MeasurementProposalCard } from './MeasurementProposalCard';
import { OutcomesSection } from './OutcomesSection';

const EXPERIMENT_ID = '11111111-1111-1111-1111-111111111111';
const proposalPath = `/experiments/${EXPERIMENT_ID}/measurement-proposal`;
const bindingPath = `/experiments/${EXPERIMENT_ID}/metric-binding`;
const outcomesPath = `/experiments/${EXPERIMENT_ID}/outcomes`;

const BINDING = {
  id: 'mb-1',
  experimentId: EXPERIMENT_ID,
  provider: 'GA4',
  config: { metric: 'conversions', dimensionFilter: null },
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z',
};

const PROPOSAL = {
  value: 42,
  unit: null,
  periodStart: '2026-07-01T00:00:00.000Z',
  periodEnd: '2026-07-14T00:00:00.000Z',
  externalRef: 'properties/123456789:conversions',
  query: { metrics: [{ name: 'conversions' }] },
  source: 'GA4',
};

const CREATED = {
  outcome: {
    id: '55555555-5555-5555-5555-555555555555',
    workspaceId: '22222222-2222-2222-2222-222222222222',
    experimentId: EXPERIMENT_ID,
    metric: 'conversions',
    value: 42,
    unit: null,
    observedAt: '2026-07-15T00:00:00.000Z',
    source: 'GA4',
    periodStart: '2026-07-01T00:00:00.000Z',
    periodEnd: '2026-07-14T00:00:00.000Z',
    externalRef: 'properties/123456789:conversions',
    sourceDetail: { metrics: [{ name: 'conversions' }] },
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    comparison: { delta: null, deltaPct: null, progressPct: null },
  },
  interpretation: { agentRunId: null, reason: 'Insufficient credits' },
};

afterEach(() => vi.unstubAllGlobals());

describe('MeasurementProposalCard', () => {
  it('mostra o número, o período e a fonte', async () => {
    stubFetch({
      [bindingPath]: { body: { binding: BINDING } },
      [proposalPath]: { body: PROPOSAL },
    });

    renderWithProviders(<MeasurementProposalCard experimentId={EXPERIMENT_ID} canMeasure />);

    expect(await screen.findByText('42')).toBeTruthy();
    expect(screen.getByText(/GA4/)).toBeTruthy();
    expect(screen.getByText(/properties\/123456789:conversions/)).toBeTruthy();
  });

  // A trava do spec §8: confirmar é concordar com a leitura, não transportá-la.
  // O corpo leva `fromSource` e NENHUM valor.
  it('confirma enviando fromSource, sem valor', async () => {
    const calls: StubFetchCall[] = [];
    stubFetch(
      {
        [bindingPath]: { body: { binding: BINDING } },
        [proposalPath]: { body: PROPOSAL },
        [outcomesPath]: { status: 201, body: CREATED },
      },
      calls,
    );

    renderWithProviders(<MeasurementProposalCard experimentId={EXPERIMENT_ID} canMeasure />);

    await userEvent.click(await screen.findByRole('button', { name: i18n.t('pages.experiments.measurement.confirm') }));

    await waitFor(() => {
      const post = calls.find((call) => call.method === 'POST');
      expect(post?.body).toEqual({ fromSource: true });
    });
  });

  // Zero é uma resposta, não uma falha. Confundir os dois é como o tracking
  // quebrado entra no Growth Brain disfarçado de resultado ruim (spec §9).
  it('mostra zero como zero, com a leitura explicada', async () => {
    stubFetch({
      [bindingPath]: { body: { binding: BINDING } },
      [proposalPath]: { body: { ...PROPOSAL, value: 0 } },
    });

    renderWithProviders(<MeasurementProposalCard experimentId={EXPERIMENT_ID} canMeasure />);

    expect(await screen.findByText('0')).toBeTruthy();
    expect(screen.getByText(i18n.t('pages.experiments.measurement.zero'))).toBeTruthy();
    // E ainda dá para confirmar: zero medido é uma medição.
    expect(screen.getByRole('button', { name: i18n.t('pages.experiments.measurement.confirm') })).toBeTruthy();
  });

  it('não busca proposta quando o experimento não tem amarração', async () => {
    const calls: StubFetchCall[] = [];
    stubFetch({ [bindingPath]: { status: 404, body: { error: { code: 'AUR-T0005' } } } }, calls);

    renderWithProviders(<MeasurementProposalCard experimentId={EXPERIMENT_ID} canMeasure />);

    expect(await screen.findByText(i18n.t('pages.experiments.measurement.noBinding'))).toBeTruthy();
    // Nenhuma chamada à proposta: sem amarração não há o que buscar, e uma
    // requisição que só pode falhar é ruído no lugar de orientação (spec §9).
    await waitFor(() => expect(calls.every((call) => call.path !== proposalPath)).toBe(true));
  });

  it('mostra a mensagem da própria fonte quando a leitura falha, com retry', async () => {
    stubFetch({
      [bindingPath]: { body: { binding: BINDING } },
      [proposalPath]: {
        status: 502,
        body: {
          error: {
            code: 'AUR-T0039',
            message: 'The source did not return the measurement: Caller does not have permission.',
          },
        },
      },
    });

    renderWithProviders(<MeasurementProposalCard experimentId={EXPERIMENT_ID} canMeasure />);

    expect(await screen.findByText(/Caller does not have permission/)).toBeTruthy();
    expect(screen.getByRole('button', { name: i18n.t('pages.experiments.measurement.retry') })).toBeTruthy();
  });

  // O piso continua de pé: o campo manual fica ao lado da proposta. Este é o
  // teste que impede a automação de virar requisito (spec §11).
  it('conviva com o formulário manual na mesma tela', async () => {
    stubFetch({
      [bindingPath]: { body: { binding: BINDING } },
      [proposalPath]: { body: PROPOSAL },
      [outcomesPath]: { body: { outcomes: [] } },
      '/credits': { body: { balance: 40, granted: 40, used: 0 } },
      '/credits/pricing': { body: { operations: [{ taskType: 'interpret-outcome', credits: 2 }] } },
    });

    renderWithProviders(
      <>
        <MeasurementProposalCard experimentId={EXPERIMENT_ID} canMeasure />
        <OutcomesSection experimentId={EXPERIMENT_ID} metric="conversions" targetValue={60} />
      </>,
    );

    expect(await screen.findByRole('button', { name: i18n.t('pages.experiments.measurement.confirm') })).toBeTruthy();
    expect(screen.getByLabelText(new RegExp(i18n.t('pages.experiments.outcomes.valueLabel'), 'i'))).toBeTruthy();
  });

  it('não busca nada enquanto o experimento não está pronto para medir', async () => {
    const calls: StubFetchCall[] = [];
    stubFetch({ [bindingPath]: { body: { binding: BINDING } } }, calls);

    renderWithProviders(<MeasurementProposalCard experimentId={EXPERIMENT_ID} canMeasure={false} />);

    await waitFor(() => expect(calls.every((call) => call.path !== proposalPath)).toBe(true));
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `cd web && pnpm vitest run src/components/experiments/MeasurementProposalCard.test.tsx`
Expected: FAIL — `Failed to resolve import "./MeasurementProposalCard"`.

- [ ] **Step 3: i18n**

`en.json`, dentro de `pages.experiments`:

```json
      "measurement": {
        "title": "What the source measured",
        "helpTitle": "Provenance",
        "help": "Where this number came from: which property, which query, which period. AUREA reads it; you confirm it. A number nobody agreed with is not a result.",
        "period": "Period",
        "source": "Source",
        "reference": "Reference",
        "confirm": "Confirm this measurement",
        "confirming": "Recording…",
        "zero": "The source answered zero for this period. That is a measurement, not a failure — but it is also what broken tracking looks like, so check the period before confirming.",
        "orManual": "Or type a different number below.",
        "retry": "Read again",
        "failed": "Could not read the measurement.",
        "noBinding": "This experiment does not say where its number comes from yet, so there is nothing to read.",
        "noSource": "No data source is connected, so there is nothing to read.",
        "noPeriod": "This experiment has no start and end dates, and without a period there is nothing to measure.",
        "notReady": "AUREA reads the number once the experiment is over."
      },
```

`pt.json`:

```json
      "measurement": {
        "title": "O que a fonte mediu",
        "helpTitle": "Proveniência",
        "help": "De onde veio este número: qual property, qual consulta, qual período. A AUREA lê; você confirma. Um número com que ninguém concordou não é resultado.",
        "period": "Período",
        "source": "Fonte",
        "reference": "Referência",
        "confirm": "Confirmar esta medição",
        "confirming": "Gravando…",
        "zero": "A fonte respondeu zero para este período. Isso é uma medição, não uma falha — mas é também a cara de um tracking quebrado, então confira o período antes de confirmar.",
        "orManual": "Ou digite outro número abaixo.",
        "retry": "Ler de novo",
        "failed": "Não foi possível ler a medição.",
        "noBinding": "Este experimento ainda não diz de onde vem o número dele, então não há o que ler.",
        "noSource": "Nenhuma fonte de dados está conectada, então não há o que ler.",
        "noPeriod": "Este experimento não tem data de início e fim, e sem período não há o que medir.",
        "notReady": "A AUREA lê o número quando o experimento termina."
      },
```

`es.json`:

```json
      "measurement": {
        "title": "Lo que midió la fuente",
        "helpTitle": "Procedencia",
        "help": "De dónde vino este número: qué propiedad, qué consulta, qué periodo. AUREA lo lee; tú lo confirmas. Un número con el que nadie estuvo de acuerdo no es un resultado.",
        "period": "Periodo",
        "source": "Fuente",
        "reference": "Referencia",
        "confirm": "Confirmar esta medición",
        "confirming": "Guardando…",
        "zero": "La fuente respondió cero para este periodo. Eso es una medición, no un fallo — pero también es lo que parece un tracking roto, así que revisa el periodo antes de confirmar.",
        "orManual": "O escribe otro número abajo.",
        "retry": "Leer de nuevo",
        "failed": "No se pudo leer la medición.",
        "noBinding": "Este experimento aún no dice de dónde viene su número, así que no hay nada que leer.",
        "noSource": "Ninguna fuente de datos está conectada, así que no hay nada que leer.",
        "noPeriod": "Este experimento no tiene fechas de inicio y fin, y sin periodo no hay nada que medir.",
        "notReady": "AUREA lee el número cuando el experimento termina."
      },
```

- [ ] **Step 4: O card**

`web/src/components/experiments/MeasurementProposalCard.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useGetMetricBinding } from '@/api/generated/hooks/experimentsHooks/useGetMetricBinding';
import { useGetMeasurementProposal } from '@/api/generated/hooks/experimentsHooks/useGetMeasurementProposal';
import { useCreateOutcome } from '@/api/generated/hooks/outcomesHooks/useCreateOutcome';
import { listOutcomesQueryKey } from '@/api/generated/hooks/outcomesHooks/useListOutcomes';
import { getExperimentQueryKey } from '@/api/generated/hooks/experimentsHooks/useGetExperiment';
import { apiErrorMessage } from '@/lib/api-errors';
import { Help } from '@/components/Help';
import { SectionLoading } from '@/components/SectionState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/** Os códigos que a rota devolve para cada recusa de setup (back: catalog.ts). */
const NO_BINDING = 'pages.experiments.measurement.noBinding';
const REFUSALS: Record<string, string> = {
  'AUR-T0036': NO_BINDING,
  'AUR-T0037': 'pages.experiments.measurement.noSource',
  'AUR-T0038': 'pages.experiments.measurement.noPeriod',
};

function refusalKey(error: unknown): string | null {
  const code = (error as { data?: { error?: { code?: unknown } } } | null | undefined)?.data?.error?.code;
  return typeof code === 'string' ? (REFUSALS[code] ?? null) : null;
}

/**
 * A leitura da fonte, mostrada antes de virar fato.
 *
 * Nada aqui grava sozinho: a proposta é transitória e confirmar é o mesmo
 * `POST /experiments/:id/outcomes` de sempre, agora com `fromSource: true` —
 * que faz o servidor **refazer** a leitura em vez de aceitar o número desta
 * tela. Confirmar é concordar com a leitura, não transportá-la (spec §8).
 */
export function MeasurementProposalCard({
  experimentId,
  canMeasure,
  onInterpretationStarted,
}: {
  experimentId: string;
  /** O experimento terminou e ainda não tem número. Falso: nada é buscado. */
  canMeasure: boolean;
  onInterpretationStarted?: (agentRunId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // A amarração é a porta: sem ela a proposta só poderia falhar, e uma
  // requisição que só pode falhar é ruído no lugar de orientação (spec §9).
  const binding = useGetMetricBinding(experimentId, { query: { retry: false } });
  const bound = binding.data?.binding != null;

  const proposal = useGetMeasurementProposal(experimentId, {
    query: { enabled: canMeasure && bound, retry: false },
  });

  const confirm = useCreateOutcome({
    mutation: {
      onMutate: () => setConfirmError(null),
      onSuccess: async (data) => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: listOutcomesQueryKey(experimentId) }),
          queryClient.invalidateQueries({ queryKey: getExperimentQueryKey(experimentId) }),
        ]);
        if (data.interpretation.agentRunId) onInterpretationStarted?.(data.interpretation.agentRunId);
      },
      onError: (error) => setConfirmError(apiErrorMessage(error, t('pages.experiments.measurement.failed'))),
    },
  });

  const formatDate = (value: Date | string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(value));

  // A constante, e não `REFUSALS['AUR-T0036']`: com `noUncheckedIndexedAccess`
  // o acesso indexado devolve `string | undefined`, e `t(undefined)` não compila.
  const refusal = refusalKey(proposal.error) ?? (binding.isError ? NO_BINDING : null);

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <p className="text-sm font-medium">
          {t('pages.experiments.measurement.title')}
          <Help title={t('pages.experiments.measurement.helpTitle')}>{t('pages.experiments.measurement.help')}</Help>
        </p>

        {!canMeasure && <p className="text-sm text-muted-foreground">{t('pages.experiments.measurement.notReady')}</p>}

        {canMeasure && refusal && <p className="text-sm text-muted-foreground">{t(refusal)}</p>}

        {canMeasure && !refusal && (proposal.isLoading || binding.isLoading) && <SectionLoading />}

        {/* Falha de leitura: a mensagem da própria fonte, e um retry. Distinta
            de zero — "não deu para ler" e "a fonte respondeu zero" não são a
            mesma notícia. */}
        {canMeasure && !refusal && proposal.isError && (
          <div className="space-y-3">
            <p className="text-sm text-destructive">
              {apiErrorMessage(proposal.error, t('pages.experiments.measurement.failed'))}
            </p>
            <Button size="sm" variant="outline" onClick={() => void proposal.refetch()}>
              {t('pages.experiments.measurement.retry')}
            </Button>
          </div>
        )}

        {canMeasure && proposal.data && (
          <div className="space-y-3">
            <p className="font-display text-3xl font-extrabold">
              {proposal.data.value}
              {proposal.data.unit ? ` ${proposal.data.unit}` : ''}
            </p>
            {proposal.data.value === 0 && (
              <p className="text-sm text-muted-foreground">{t('pages.experiments.measurement.zero')}</p>
            )}
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>
                {t('pages.experiments.measurement.period')}: {formatDate(proposal.data.periodStart)} →{' '}
                {formatDate(proposal.data.periodEnd)}
              </p>
              <p className="flex items-center gap-2">
                {t('pages.experiments.measurement.source')}: <Badge variant="muted">{proposal.data.source}</Badge>
              </p>
              <p className="font-mono text-xs">
                {t('pages.experiments.measurement.reference')}: {proposal.data.externalRef}
              </p>
            </div>

            {confirmError && <p className="text-sm text-destructive">{confirmError}</p>}

            <Button
              size="sm"
              disabled={confirm.isPending}
              // Sem `value` no corpo: o servidor refaz a leitura. Mandar o
              // número daqui seria um número sem origem com selo de origem.
              onClick={() => confirm.mutate({ id: experimentId, data: { fromSource: true } })}
            >
              {confirm.isPending
                ? t('pages.experiments.measurement.confirming')
                : t('pages.experiments.measurement.confirm')}
            </Button>
            <p className="text-xs text-muted-foreground">{t('pages.experiments.measurement.orManual')}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

Confira contra o código gerado: o nome exato de `useGetMeasurementProposal`, a forma da opção de query (`{ query: { enabled, retry } }`) e se `apiErrorMessage` lê a mensagem de `error.data.error.message` (é o que `lib/api-errors.ts` faz nos outros usos).

- [ ] **Step 5: Monte na página**

`web/src/pages/ExperimentDetailPage.tsx` — import e montagem acima de `OutcomesSection`, na coluna da esquerda:

```tsx
import { MeasurementProposalCard } from '@/components/experiments/MeasurementProposalCard';
```
```tsx
        <div className="space-y-4">
          <MeasurementProposalCard
            experimentId={id}
            // Só depois de o experimento terminar e enquanto não houver número:
            // pedir a leitura de um experimento correndo mede meio teste.
            canMeasure={state.status === 'COMPLETED' && (outcomes.data?.outcomes.length ?? 0) === 0}
            onInterpretationStarted={setInterpretRunId}
          />
          <OutcomesSection
            experimentId={id}
            metric={state.metric}
            targetValue={state.targetValue}
            onInterpretationStarted={setInterpretRunId}
          />
        </div>
```

(A coluna da esquerda passa a ser um `div` com `space-y-4` envolvendo os dois; a coluna da direita segue como está, já com o `MetricBindingCard` da Task 6.)

- [ ] **Step 6: Rode a suíte inteira do web**

Run: `cd web && pnpm typecheck && pnpm test`
Expected: tsc exit 0; suíte passando. Baseline antes desta parte: **673 testes**. Reporte o número novo. **Rode a suíte do web sozinha** — rodá-la junto com a do back já produziu 6-7 falhas fantasma por disputa de recurso nesta máquina.

- [ ] **Step 7: Stage e mostre o diff (NÃO comite)**

```bash
cd web && git add src/components/experiments src/pages/ExperimentDetailPage.tsx src/i18n
git status --short && git diff --cached --stat
```

Mensagem sugerida: `feat(web): confirm the measurement the source read`

---

## Verificação final (depois das sete tasks)

- [ ] `cd back && pnpm typecheck && pnpm test` — tsc 0, suíte verde
- [ ] `cd back && pnpm prisma migrate status` — "Database schema is up to date!"
- [ ] `cd web && pnpm typecheck && pnpm test` — tsc 0, suíte verde (sozinha)
- [ ] `cd back && pnpm openapi:dump && cd ../web && pnpm api:generate` — sem diff pendente depois de rodados
- [ ] Conferir à mão que nenhuma resposta nova carrega `ciphertext`/`iv`/`authTag`: `grep -rn "ciphertext" back/src/http | grep -v repository | grep -v test`
- [ ] Conferir que nenhum teste chama a rede: `grep -rn "analyticsdata.googleapis" back/src --include=*.test.ts` deve sair vazio, e `grep -rln "createGa4Provider" back/src --include=*.test.ts` só deve listar os testes do próprio provider (que stubam `fetch`)

## Fora de escopo desta parte (decidido no spec)

Execução (3b: `Action`, `Approval`, Postiz); segunda fonte e normalização entre fontes; catálogo de métricas do workspace; `confidence` no `Outcome`; OAuth Google; job de fundo puxando medição; atribuição e detecção de anomalia; ingestão de evento cru.

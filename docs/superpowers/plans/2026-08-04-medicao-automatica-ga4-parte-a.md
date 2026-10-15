# Medição automática (GA4) — Parte A: fonte conectada e amarrada

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AUREA passa a conseguir ler a property GA4 do fundador e a saber, por experimento, qual métrica da fonte responde pela métrica dele — com um agente pré-preenchendo essa amarração.

**Architecture:** Um contrato de capacidade (`AnalyticsProvider`) separado da implementação, no mesmo formato de `search-provider.ts`; a credencial vive selada por workspace no mesmo AES-256-GCM do BYOK e é verificada antes de ser gravada; a amarração é uma linha 1:1 com o experimento, validada por schema Zod por provider; e um agente propõe essa linha lendo as métricas que a property realmente tem.

**Tech Stack:** Node 22, Fastify 5, TypeScript strict ESM (`.js` nos imports), Zod 3 + `fastify-type-provider-zod` 4, Prisma 6 + PostgreSQL, Vitest. Uma dependência nova: `google-auth-library`.

Spec: `back/docs/superpowers/specs/2026-08-04-medicao-automatica-ga4-design.md` (§3 a §6, §11, §12 passos 1-3).
Parte B (leitura, proveniência no Outcome, telas) é outro plano, escrito depois desta parte estar executada.

## Global Constraints

- **Commit exige aprovação explícita.** Cada task termina em `git add` + `git status` + diff resumido; **não rode `git commit` sem o "ok" do humano.**
- **O segredo nunca sai numa resposta.** Nenhuma rota devolve `ciphertext`, `iv`, `authTag` nem o JSON da credencial. Cada rota de integração tem um teste que afirma isso.
- **Zod 3**, não 4 (`z.string().uuid()`, nunca `z.uuid()`).
- **Escopo GA4 somente leitura:** `https://www.googleapis.com/auth/analytics.readonly`. Nada no código pede escopo de escrita.
- **Isolamento de tenant absoluto:** `workspaceId` sempre de `req.tenant`, nunca de body/query/params. Toda rota tenant-scoped ganha teste de negação cross-tenant.
- **Toda rota tem `operationId` e `response`.**
- **Erros só tipados**: subclasses de `AppError` de `src/lib/errors.ts`. Nunca `throw new Error()` num caminho de requisição; o conector lança `AnalyticsProviderError`, que o serviço traduz.
- **Nenhum teste toca a rede.** O minter de token é injetado; `fetch` é stubado com `vi.stubGlobal`, como em `src/integrations/search/tavily.test.ts`.
- **Nenhum corte silencioso:** se a lista de métricas for truncada para caber no prompt, a saída da tool diz que truncou e quantas ficaram fora.
- **A amarração é proveniência**: o agente propõe, o humano confirma. Nada grava `MetricBinding` sem uma ação humana explícita.
- **Nenhum código gera, infere ou assume** `baselineValue`, `targetValue`, `startDate` ou `endDate`.
- Migração: **escreva o `migration.sql` à mão** numa pasta com timestamp, depois `npx prisma migrate deploy` e `npx prisma generate`. **Nunca `migrate reset`, nunca `migrate dev`** — o histórico deste repo já sofreu drift de checksum uma vez.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `src/integrations/analytics/analytics-provider.ts` **(criar)** | O contrato da capacidade: tipos + interface + erro tipado. Zero código de fornecedor |
| `src/integrations/analytics/ga4/ga4-token.ts` **(criar)** | Cunhar token a partir do JSON de service account. Único arquivo que conhece `google-auth-library` |
| `src/integrations/analytics/ga4/ga4-provider.ts` **(criar)** | `createGa4Provider` — `health`, `listMetrics`, `readMetric` via `fetch` |
| `src/integrations/analytics/ga4/ga4-provider.test.ts` **(criar)** | Feliz, 401, 404, zero linhas, corpo inesperado |
| `src/integrations/analytics/index.ts` **(criar)** | Reexporta o contrato e a fábrica |
| `prisma/schema.prisma` **(modificar)** | `WorkspaceIntegration` (Task 2) e `MetricBinding` (Task 3) |
| `src/http/api/integrations/integrations.repository.ts` **(criar)** | Consultas por `workspaceId` + provider |
| `src/http/api/integrations/integrations.schema.ts` **(criar)** | Schemas compartilhados + presenter da resposta sem segredo |
| `src/http/api/integrations/integrations.service.ts` **(criar)** | Selar, verificar antes de gravar, marcar status |
| `src/http/api/integrations/{list-integrations,put-integration,remove-integration}/` **(criar)** | Um slice por caso de uso |
| `src/http/api/integrations/index.ts` **(criar)** | Registra as rotas com `authenticate` + `resolveTenant` |
| `src/app.ts` **(modificar)** | Registra `integrationsRoutes` |
| `src/http/api/experiments/metric-binding.schema.ts` **(criar)** | `ga4BindingConfig` + envelope de resposta |
| `src/http/api/experiments/metric-binding.repository.ts` **(criar)** | `find`, `upsert`, `remove`, todos por `workspaceId` |
| `src/http/api/experiments/{get-metric-binding,put-metric-binding,remove-metric-binding}/` **(criar)** | Um slice por caso de uso |
| `src/http/api/experiments/index.ts` **(modificar)** | Registra as três rotas |
| `src/ai/tools/list-source-metrics.ts` **(criar)** | Tool: as métricas e dimensões que a property tem |
| `src/ai/agents/fill/propose-metric-binding.ts` **(criar)** | O agente que propõe a amarração |
| `src/ai/agents/registry.ts` **(modificar)** | Registra o agente |
| `src/billing/operation-cost.ts` **(modificar)** | `'propose-metric-binding': 1` |
| `src/http/api/write-guard.test.ts` **(modificar)** | As rotas novas de escrita sob VIEWER |

---

## Task 1: Conector GA4

**Files:**
- Create: `back/src/integrations/analytics/analytics-provider.ts`
- Create: `back/src/integrations/analytics/ga4/ga4-token.ts`
- Create: `back/src/integrations/analytics/ga4/ga4-provider.ts`
- Create: `back/src/integrations/analytics/index.ts`
- Test: `back/src/integrations/analytics/ga4/ga4-provider.test.ts`

**Interfaces:**
- Consumes: nada de dentro do projeto além de Zod.
- Produces:
  - `export type MetricPeriod = { startDate: Date; endDate: Date }`
  - `export type MetricDescriptor = { apiName: string; uiName: string; description: string; custom: boolean }`
  - `export type MetricReading = { value: number; unit: string | null; externalRef: string; query: unknown }`
  - `export interface AnalyticsProvider { readonly name: string; health(signal: AbortSignal): Promise<void>; listMetrics(signal: AbortSignal): Promise<{ metrics: MetricDescriptor[]; dimensions: MetricDescriptor[] }>; readMetric(config: unknown, period: MetricPeriod, signal: AbortSignal): Promise<MetricReading> }`
  - `export class AnalyticsProviderError extends Error`
  - `export type Ga4Config = { metric: string; dimensionFilter?: { fieldName: string; value: string } | null }`
  - `export function createGa4Provider(deps: { propertyId: string; mintToken: () => Promise<string> }): AnalyticsProvider`
  - `export function serviceAccountMinter(credentialsJson: string): () => Promise<string>`

- [ ] **Step 1: Instale a dependência**

```bash
cd back && pnpm add google-auth-library
```

Ela é usada **só** para cunhar o token (assinar JWT RS256 e renová-lo). As chamadas de report e metadata continuam `fetch` cru, como `tavily.ts`.

- [ ] **Step 2: Escreva o teste que falha**

`back/src/integrations/analytics/ga4/ga4-provider.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsProviderError } from '../analytics-provider.js';
import { createGa4Provider } from './ga4-provider.js';

const PROPERTY = '123456789';
const PERIOD = { startDate: new Date('2026-08-01T00:00:00.000Z'), endDate: new Date('2026-08-14T00:00:00.000Z') };

const provider = () => createGa4Provider({ propertyId: PROPERTY, mintToken: async () => 'fake-token' });

/** Uma resposta HTTP falsa, e o registro do que foi pedido. */
function stub(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }),
  );
  return calls;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('createGa4Provider.readMetric', () => {
  it('lê o total do período e devolve a consulta que o produziu', async () => {
    const calls = stub(200, { totals: [{ metricValues: [{ value: '42' }] }], rowCount: 1 });

    const reading = await provider().readMetric({ metric: 'conversions' }, PERIOD, AbortSignal.timeout(5_000));

    expect(reading.value).toBe(42);
    expect(reading.externalRef).toBe(`properties/${PROPERTY}:conversions`);
    expect(calls[0].url).toBe(`https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY}:runReport`);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      // Datas em YYYY-MM-DD UTC: a mesma fronteira de dia que experiments.clock.ts
      // usa. Duas regras de dia divergindo mediriam um período diferente do que o
      // relógio fechou.
      dateRanges: [{ startDate: '2026-08-01', endDate: '2026-08-14' }],
      metrics: [{ name: 'conversions' }],
      metricAggregations: ['TOTAL'],
    });
    expect(calls[0].init?.headers).toMatchObject({ authorization: 'Bearer fake-token' });
  });

  it('manda o filtro de dimensão quando a amarração tem um', async () => {
    const calls = stub(200, { totals: [{ metricValues: [{ value: '7' }] }], rowCount: 1 });

    await provider().readMetric(
      { metric: 'eventCount', dimensionFilter: { fieldName: 'eventName', value: 'sign_up' } },
      PERIOD,
      AbortSignal.timeout(5_000),
    );

    expect(JSON.parse(String(calls[0].init?.body)).dimensionFilter).toEqual({
      filter: { fieldName: 'eventName', stringFilter: { value: 'sign_up' } },
    });
  });

  // Zero não é falha de leitura. Confundir os dois é como tracking quebrado
  // entra no Growth Brain disfarçado de resultado ruim (spec §9).
  it('devolve zero quando a fonte respondeu zero, em vez de erro', async () => {
    stub(200, { rowCount: 0 });

    const reading = await provider().readMetric({ metric: 'conversions' }, PERIOD, AbortSignal.timeout(5_000));

    expect(reading.value).toBe(0);
  });

  it('recusa credencial inválida sem inventar número', async () => {
    stub(401, { error: { message: 'Request had invalid authentication credentials.' } });

    await expect(
      provider().readMetric({ metric: 'conversions' }, PERIOD, AbortSignal.timeout(5_000)),
    ).rejects.toBeInstanceOf(AnalyticsProviderError);
  });

  it('recusa property inexistente ou sem permissão', async () => {
    stub(404, { error: { message: 'Property not found.' } });

    await expect(
      provider().readMetric({ metric: 'conversions' }, PERIOD, AbortSignal.timeout(5_000)),
    ).rejects.toBeInstanceOf(AnalyticsProviderError);
  });

  // Um contrato quebrado tem de falhar aqui. Sem isto, `undefined` viraria
  // `NaN` e `NaN` viraria um Outcome.
  it('recusa um corpo que não tem a forma esperada', async () => {
    stub(200, { totals: [{ metricValues: [{ value: 'não é número' }] }], rowCount: 1 });

    await expect(
      provider().readMetric({ metric: 'conversions' }, PERIOD, AbortSignal.timeout(5_000)),
    ).rejects.toBeInstanceOf(AnalyticsProviderError);
  });

  it('recusa uma amarração malformada antes de chamar a fonte', async () => {
    const calls = stub(200, {});

    await expect(provider().readMetric({}, PERIOD, AbortSignal.timeout(5_000))).rejects.toBeInstanceOf(
      AnalyticsProviderError,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('createGa4Provider.listMetrics', () => {
  it('mapeia o metadata da property para descritores', async () => {
    const calls = stub(200, {
      name: `properties/${PROPERTY}/metadata`,
      metrics: [
        { apiName: 'conversions', uiName: 'Conversions', description: 'The count of conversion events.', customDefinition: false },
      ],
      dimensions: [
        { apiName: 'eventName', uiName: 'Event name', description: 'The name of the event.', customDefinition: false },
        { apiName: 'customUser:plan', uiName: 'Plan', description: 'Custom.', customDefinition: true },
      ],
    });

    const { metrics, dimensions } = await provider().listMetrics(AbortSignal.timeout(5_000));

    expect(calls[0].url).toBe(`https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY}/metadata`);
    expect(metrics).toEqual([
      { apiName: 'conversions', uiName: 'Conversions', description: 'The count of conversion events.', custom: false },
    ]);
    expect(dimensions[1].custom).toBe(true);
  });

  // `description` é opcional na resposta real; sem o default o descritor
  // chegaria com `undefined` num campo que o tipo declara string.
  it('aceita metadata sem descrição', async () => {
    stub(200, { metrics: [{ apiName: 'sessions', uiName: 'Sessions' }], dimensions: [] });

    expect((await provider().listMetrics(AbortSignal.timeout(5_000))).metrics[0].description).toBe('');
  });
});

describe('createGa4Provider.health', () => {
  it('passa quando o metadata responde', async () => {
    stub(200, { metrics: [], dimensions: [] });

    await expect(provider().health(AbortSignal.timeout(5_000))).resolves.toBeUndefined();
  });

  it('falha com a mensagem da fonte quando a credencial não serve', async () => {
    stub(403, { error: { message: 'Caller does not have permission.' } });

    await expect(provider().health(AbortSignal.timeout(5_000))).rejects.toThrow(/permission/i);
  });
});
```

- [ ] **Step 3: Rode e confirme que falha**

Run: `cd back && npx vitest run src/integrations/analytics/`
Expected: FAIL — `Failed to resolve import "./ga4-provider.js"`.

- [ ] **Step 4: Escreva o contrato**

`back/src/integrations/analytics/analytics-provider.ts`:

```ts
// O contrato existe separado da implementação pela mesma razão que o de busca
// (`search/search-provider.ts`): o princípio 5 do CLAUDE.md pede independência de
// fornecedor. Trocar GA4 por PostHog não pode exigir tocar no agente, na tool,
// nem no serviço que grava o Outcome.

export type MetricPeriod = { startDate: Date; endDate: Date };

export type MetricDescriptor = {
  /** Nome usável na consulta — `apiName` no GA4. */
  apiName: string;
  /** Nome que o humano vê na interface da fonte. */
  uiName: string;
  description: string;
  /** Criada pelo próprio cliente na property, não universal da fonte. */
  custom: boolean;
};

export type MetricReading = {
  value: number;
  /** Null quando a fonte não declara unidade — diferente de adimensional. */
  unit: string | null;
  /** O que foi lido, para auditoria: property + métrica. */
  externalRef: string;
  /** A consulta exata que produziu o número, como a fonte a recebeu. */
  query: unknown;
};

export interface AnalyticsProvider {
  readonly name: string;
  /** Passa em silêncio; lança com a mensagem da fonte quando a credencial não serve. */
  health(signal: AbortSignal): Promise<void>;
  listMetrics(signal: AbortSignal): Promise<{ metrics: MetricDescriptor[]; dimensions: MetricDescriptor[] }>;
  readMetric(config: unknown, period: MetricPeriod, signal: AbortSignal): Promise<MetricReading>;
}

/**
 * Falha da fonte, não do domínio. Quem chama traduz para um `AppError` — o
 * conector não conhece HTTP status do nosso lado.
 */
export class AnalyticsProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalyticsProviderError';
  }
}
```

- [ ] **Step 5: Escreva o minter de token**

`back/src/integrations/analytics/ga4/ga4-token.ts`:

```ts
import { JWT } from 'google-auth-library';
import { AnalyticsProviderError } from '../analytics-provider.js';

/**
 * Somente leitura, e isto é design e não configuração: um token que pode
 * escrever numa property é um token que pode apagar a medição do cliente.
 */
const SCOPES = ['https://www.googleapis.com/auth/analytics.readonly'];

/**
 * Cunha o token a partir do JSON de uma service account.
 *
 * Único arquivo que conhece `google-auth-library`. A biblioteca entra aqui em
 * vez de um JWT RS256 escrito à mão porque assinar e renovar token é
 * criptografia, e criptografia escrita em casa para economizar uma dependência é
 * o tipo de economia que custa um incidente. O cache de token é dela.
 */
export function serviceAccountMinter(credentialsJson: string): () => Promise<string> {
  let client: JWT | null = null;

  return async () => {
    if (!client) {
      let parsed: { client_email?: unknown; private_key?: unknown };
      try {
        parsed = JSON.parse(credentialsJson) as typeof parsed;
      } catch {
        throw new AnalyticsProviderError('the service account credential is not valid JSON');
      }
      if (typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') {
        throw new AnalyticsProviderError('the service account credential has no client_email or private_key');
      }
      client = new JWT({ email: parsed.client_email, key: parsed.private_key, scopes: SCOPES });
    }

    const { token } = await client.getAccessToken();
    if (!token) throw new AnalyticsProviderError('google did not return an access token');
    return token;
  };
}

/** O e-mail da service account, para o fundador reconhecer o que conectou. */
export function serviceAccountEmail(credentialsJson: string): string {
  try {
    const parsed = JSON.parse(credentialsJson) as { client_email?: unknown };
    return typeof parsed.client_email === 'string' ? parsed.client_email : 'unknown service account';
  } catch {
    return 'unknown service account';
  }
}
```

- [ ] **Step 6: Escreva o conector**

`back/src/integrations/analytics/ga4/ga4-provider.ts`:

```ts
import { z } from 'zod';
import {
  AnalyticsProviderError,
  type AnalyticsProvider,
  type MetricDescriptor,
  type MetricPeriod,
  type MetricReading,
} from '../analytics-provider.js';

const BASE = 'https://analyticsdata.googleapis.com/v1beta';

/** A amarração que este provider entende. Validada aqui, não confiada. */
export const ga4ConfigSchema = z.object({
  metric: z.string().min(1).max(160),
  dimensionFilter: z
    .object({ fieldName: z.string().min(1).max(160), value: z.string().min(1).max(200) })
    .nullish(),
});

export type Ga4Config = z.infer<typeof ga4ConfigSchema>;

/** Um descritor do metadata. `description` é opcional na resposta real. */
const descriptorSchema = z.object({
  apiName: z.string(),
  uiName: z.string(),
  description: z.string().optional(),
  customDefinition: z.boolean().optional(),
});

const metadataSchema = z.object({
  metrics: z.array(descriptorSchema).default([]),
  dimensions: z.array(descriptorSchema).default([]),
});

const reportSchema = z.object({
  // Ausente quando a consulta não casou nada. Zero linhas é uma resposta, não
  // uma falha.
  rowCount: z.number().optional(),
  totals: z
    .array(z.object({ metricValues: z.array(z.object({ value: z.string() })) }))
    .optional(),
});

/** YYYY-MM-DD em UTC — a mesma fronteira de dia de `experiments.clock.ts`. */
function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toDescriptor(raw: z.infer<typeof descriptorSchema>): MetricDescriptor {
  return {
    apiName: raw.apiName,
    uiName: raw.uiName,
    description: raw.description ?? '',
    custom: raw.customDefinition ?? false,
  };
}

export function createGa4Provider(deps: { propertyId: string; mintToken: () => Promise<string> }): AnalyticsProvider {
  const { propertyId, mintToken } = deps;

  async function call(path: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
    const token = await mintToken();
    const response = await fetch(`${BASE}/properties/${propertyId}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    });

    if (!response.ok) {
      // A mensagem da própria fonte, quando ela dá uma: "Caller does not have
      // permission" diz ao fundador o que fazer; "status 403" não diz nada.
      const detail = await response
        .json()
        .then((json: unknown) => {
          const parsed = z.object({ error: z.object({ message: z.string() }) }).safeParse(json);
          return parsed.success ? parsed.data.error.message : null;
        })
        .catch(() => null);
      throw new AnalyticsProviderError(detail ?? `ga4 request failed with status ${response.status}`);
    }

    try {
      return await response.json();
    } catch {
      throw new AnalyticsProviderError('ga4 returned a response body that is not valid JSON');
    }
  }

  return {
    name: 'ga4',

    async health(signal: AbortSignal): Promise<void> {
      // O metadata é a leitura mais barata que já exige credencial válida e
      // acesso à property: se ele passa, uma medição vai passar.
      const parsed = metadataSchema.safeParse(await call('/metadata', signal));
      if (!parsed.success) throw new AnalyticsProviderError('ga4 returned unreadable metadata');
    },

    async listMetrics(signal: AbortSignal) {
      const parsed = metadataSchema.safeParse(await call('/metadata', signal));
      if (!parsed.success) throw new AnalyticsProviderError('ga4 returned unreadable metadata');
      return {
        metrics: parsed.data.metrics.map(toDescriptor),
        dimensions: parsed.data.dimensions.map(toDescriptor),
      };
    },

    async readMetric(config: unknown, period: MetricPeriod, signal: AbortSignal): Promise<MetricReading> {
      // Antes de qualquer chamada: uma amarração malformada não pode virar uma
      // consulta pela metade contra a property do cliente.
      const valid = ga4ConfigSchema.safeParse(config);
      if (!valid.success) throw new AnalyticsProviderError('the metric binding is not a valid ga4 binding');

      const query = {
        dateRanges: [{ startDate: utcDay(period.startDate), endDate: utcDay(period.endDate) }],
        metrics: [{ name: valid.data.metric }],
        ...(valid.data.dimensionFilter
          ? {
              dimensionFilter: {
                filter: {
                  fieldName: valid.data.dimensionFilter.fieldName,
                  stringFilter: { value: valid.data.dimensionFilter.value },
                },
              },
            }
          : {}),
        // Sem `dimensions`: a leitura quer um número do período inteiro, não uma
        // série. O valor sai do total agregado.
        metricAggregations: ['TOTAL'],
      };

      const parsed = reportSchema.safeParse(await call(':runReport', signal, query));
      if (!parsed.success) throw new AnalyticsProviderError('ga4 returned an unreadable report');

      const raw = parsed.data.totals?.[0]?.metricValues?.[0]?.value;
      // Nenhuma linha no período: a fonte respondeu zero. Diferente de "não deu
      // para ler", e a diferença importa — ver spec §9.
      if (raw === undefined) {
        if ((parsed.data.rowCount ?? 0) === 0) {
          return { value: 0, unit: null, externalRef: `properties/${propertyId}:${valid.data.metric}`, query };
        }
        throw new AnalyticsProviderError('ga4 returned a report without a total');
      }

      const value = Number(raw);
      if (!Number.isFinite(value)) throw new AnalyticsProviderError(`ga4 returned a non-numeric total: ${raw}`);

      return {
        value,
        // O GA4 Data API não declara unidade por métrica no report; quem sabe a
        // unidade é o fundador, e ele a informa no Outcome.
        unit: null,
        externalRef: `properties/${propertyId}:${valid.data.metric}`,
        query,
      };
    },
  };
}
```

`back/src/integrations/analytics/index.ts`:

```ts
export * from './analytics-provider.js';
export { createGa4Provider, ga4ConfigSchema, type Ga4Config } from './ga4/ga4-provider.js';
export { serviceAccountMinter, serviceAccountEmail } from './ga4/ga4-token.js';
```

- [ ] **Step 7: Rode e confirme que passa**

Run: `cd back && npx vitest run src/integrations/analytics/ && npx tsc --noEmit; echo "EXIT=$?"`
Expected: todos PASS, `EXIT=0`.

- [ ] **Step 8: Stage e mostre para aprovação**

```bash
cd back
git add package.json pnpm-lock.yaml src/integrations/analytics/
git status --short
git diff --cached --stat
```

Mensagem sugerida (só depois do "ok"):

```
feat(analytics): read one metric from a GA4 property

Contrato de capacidade separado da implementação, como o de busca: o domínio
depende de AnalyticsProvider, nunca do Google. Três operações e não as sete do
integration-architecture §4 — publicar é outro subprojeto, o Data API não empurra
webhook, e capabilities() sem uma segunda fonte é cerimônia.

Zero linhas no período devolve zero, não erro: confundir "a fonte respondeu zero"
com "não deu para ler" é como tracking quebrado entra no Growth Brain disfarçado
de resultado ruim. Corpo inesperado lança em vez de virar NaN.

google-auth-library entra só para cunhar o token — assinar JWT RS256 e renovar à
mão é criptografia escrita em casa por economia de 40 kB. Escopo analytics.readonly:
um token que escreve numa property é um token que apaga a medição do cliente.
```

---

## Task 2: Credencial da integração

**Files:**
- Modify: `back/prisma/schema.prisma` (novo modelo + relação em `Workspace`)
- Create: `back/prisma/migrations/20260804120000_workspace_integration/migration.sql`
- Create: `back/src/http/api/integrations/integrations.repository.ts`
- Create: `back/src/http/api/integrations/integrations.schema.ts`
- Create: `back/src/http/api/integrations/integrations.service.ts`
- Create: `back/src/http/api/integrations/list-integrations/list-integrations.controller.ts`
- Create: `back/src/http/api/integrations/put-integration/{put-integration.schema.ts,put-integration.controller.ts}`
- Create: `back/src/http/api/integrations/remove-integration/remove-integration.controller.ts`
- Create: `back/src/http/api/integrations/index.ts`
- Modify: `back/src/app.ts`
- Test: `back/src/http/api/integrations/integrations.test.ts`

**Interfaces:**
- Consumes: `seal`/`open` de `src/billing/crypto.ts`; `createGa4Provider`/`serviceAccountMinter`/`serviceAccountEmail` da Task 1; `assertAdmin` de `src/lib/tenant.js`.
- Produces:
  - `createIntegrationsRepository(prisma)` com `list(workspaceId)`, `find(workspaceId, provider)`, `upsert(...)`, `remove(workspaceId, provider)`, `markHealth(id, { status, lastError, lastCheckedAt })`
  - `createIntegrationsService({ repo, verify })` com `list`, `put`, `remove`
  - `openIntegrationCredential(row): string` — o único caminho que devolve texto claro; nenhuma rota o chama
  - `presentIntegration(row)` — resposta sem segredo

- [ ] **Step 1: Escreva o teste que falha**

`back/src/http/api/integrations/integrations.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../lib/errors.js';
import { integrationsRoutes } from './index.js';

const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';
const CREDENTIAL = JSON.stringify({ client_email: 'aurea@project.iam.gserviceaccount.com', private_key: 'pk' });

const ROW = {
  id: 'int-1',
  workspaceId: WORKSPACE_ID,
  provider: 'GA4',
  authKind: 'SERVICE_ACCOUNT',
  ciphertext: Buffer.from('cipher'),
  iv: Buffer.from('iv'),
  authTag: Buffer.from('tag'),
  externalId: '123456789',
  accountLabel: 'aurea@project.iam.gserviceaccount.com',
  status: 'OK',
  lastCheckedAt: new Date('2026-08-04T00:00:00.000Z'),
  lastError: null,
  createdBy: 'u1',
  createdAt: new Date('2026-08-04T00:00:00.000Z'),
  updatedAt: new Date('2026-08-04T00:00:00.000Z'),
};

const prismaFake = () => ({
  workspaceIntegration: {
    findMany: vi.fn().mockResolvedValue([ROW]),
    findFirst: vi.fn().mockResolvedValue(ROW),
    upsert: vi.fn().mockResolvedValue(ROW),
    update: vi.fn().mockResolvedValue(ROW),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
});

beforeEach(() => vi.clearAllMocks());

async function buildApp(prisma: unknown, role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' = 'ADMIN') {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prisma as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: WORKSPACE_ID, role };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
    throw error;
  });
  await app.register(integrationsRoutes);
  return app;
}

describe('GET /integrations', () => {
  it('lista o que está conectado sem devolver o segredo', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({ method: 'GET', url: '/integrations' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.integrations[0]).toMatchObject({
      provider: 'GA4',
      authKind: 'SERVICE_ACCOUNT',
      externalId: '123456789',
      accountLabel: 'aurea@project.iam.gserviceaccount.com',
      status: 'OK',
    });
    // A trava que importa: um `select` acrescentado sem cuidado vazaria a chave
    // do cliente numa resposta HTTP.
    const raw = res.body;
    expect(raw).not.toContain('cipher');
    expect(raw).not.toContain('private_key');
    expect(Object.keys(body.integrations[0])).not.toContain('ciphertext');
  });

  it('lê apenas dentro do workspace do tenant', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    await app.inject({ method: 'GET', url: '/integrations' });

    expect(prisma.workspaceIntegration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: WORKSPACE_ID } }),
    );
  });
});

describe('PUT /integrations', () => {
  const body = {
    provider: 'GA4',
    authKind: 'SERVICE_ACCOUNT',
    externalId: '123456789',
    credentials: CREDENTIAL,
  };

  // Verificar antes de gravar, como provider-key já faz: credencial errada
  // aceita em silêncio só apareceria como medição falhando dias depois.
  it('verifica a credencial contra a fonte antes de gravar', async () => {
    const prisma = prismaFake();
    const verify = vi.fn().mockResolvedValue({ ok: true as const, accountLabel: 'aurea@project.iam.gserviceaccount.com' });
    const app = await buildApp(prisma);
    // O controller injeta o verificador real; o teste substitui pelo fake via
    // decorate — ver a nota de implementação no Step 4.
    app.decorate('verifyIntegration', verify as never);

    const res = await app.inject({ method: 'PUT', url: '/integrations', payload: body });

    expect(res.statusCode).toBe(200);
    expect(verify).toHaveBeenCalled();
    expect(prisma.workspaceIntegration.upsert).toHaveBeenCalled();
  });

  it('recusa e não grava quando a fonte rejeita a credencial', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);
    app.decorate('verifyIntegration', vi.fn().mockResolvedValue({ ok: false as const, reason: 'Caller does not have permission.' }) as never);

    const res = await app.inject({ method: 'PUT', url: '/integrations', payload: body });

    expect(res.statusCode).toBe(400);
    expect(prisma.workspaceIntegration.upsert).not.toHaveBeenCalled();
  });

  it('grava com o workspace do tenant, ignorando qualquer id no corpo', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);
    app.decorate('verifyIntegration', vi.fn().mockResolvedValue({ ok: true as const, accountLabel: 'x' }) as never);

    await app.inject({
      method: 'PUT',
      url: '/integrations',
      payload: { ...body, workspaceId: '00000000-0000-0000-0000-000000000000' },
    });

    const args = prisma.workspaceIntegration.upsert.mock.calls[0][0] as { create: { workspaceId: string } };
    expect(args.create.workspaceId).toBe(WORKSPACE_ID);
  });

  it('nega para quem não é admin', async () => {
    const app = await buildApp(prismaFake(), 'MEMBER');

    expect((await app.inject({ method: 'PUT', url: '/integrations', payload: body })).statusCode).toBe(403);
  });
});

describe('DELETE /integrations', () => {
  it('remove só dentro do workspace', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    const res = await app.inject({ method: 'DELETE', url: '/integrations?provider=GA4' });

    expect(res.statusCode).toBe(204);
    expect(prisma.workspaceIntegration.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, provider: 'GA4' },
    });
  });

  it('nega para quem não é admin', async () => {
    const app = await buildApp(prismaFake(), 'VIEWER');

    expect((await app.inject({ method: 'DELETE', url: '/integrations?provider=GA4' })).statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `cd back && npx vitest run src/http/api/integrations/`
Expected: FAIL — `Failed to resolve import "./index.js"`.

- [ ] **Step 3: Modelo e migração**

Em `back/prisma/schema.prisma`, depois de `WorkspaceProviderKey`:

```prisma
/// Uma fonte externa conectada a um workspace. Hoje só analytics (GA4); a
/// segunda fonte entra aqui, não num modelo novo.
model WorkspaceIntegration {
  id          String @id @default(uuid())
  workspaceId String
  /// 'GA4' hoje.
  provider    String
  /// 'SERVICE_ACCOUNT' | 'OAUTH' — como o conector obtém o token. O caminho
  /// OAuth depende de verificação do app pelo Google e ainda não existe; o
  /// discriminador existe para que ele entre sem migrar dado.
  authKind    String
  /// Segredo selado no mesmo AES-256-GCM do BYOK (billing/crypto.ts).
  ciphertext  Bytes
  iv          Bytes
  authTag     Bytes
  /// Identificador na fonte — a property GA4. Fora do segredo de propósito: não
  /// é sigilo, e a tela precisa mostrá-lo.
  externalId  String
  /// O que o fundador reconhece: e-mail da service account, ou a conta Google.
  accountLabel String
  /// 'UNVERIFIED' | 'OK' | 'FAILED'. Guardado em vez de recalculado: health()
  /// é uma chamada de rede, e a lista não pode custar uma ida ao Google por
  /// render.
  status        String    @default("UNVERIFIED")
  lastCheckedAt DateTime?
  lastError     String?
  createdBy     String
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, provider])
  @@index([workspaceId])
}
```

E em `model Workspace`, junto das outras relações:

```prisma
  integrations WorkspaceIntegration[]
```

`back/prisma/migrations/20260804120000_workspace_integration/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "WorkspaceIntegration" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "authKind" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "externalId" TEXT NOT NULL,
    "accountLabel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceIntegration_workspaceId_provider_key" ON "WorkspaceIntegration"("workspaceId", "provider");

-- CreateIndex
CREATE INDEX "WorkspaceIntegration_workspaceId_idx" ON "WorkspaceIntegration"("workspaceId");

-- AddForeignKey
ALTER TABLE "WorkspaceIntegration" ADD CONSTRAINT "WorkspaceIntegration_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Aplique e regenere:

```bash
cd back && npx prisma migrate deploy && npx prisma generate && npx prisma migrate status
```

Expected: `migrate deploy` aplica uma migração, `migrate status` diz que o schema está atualizado. **Se `migrate deploy` reclamar de drift, pare e reporte** — não rode `migrate dev` nem `reset`.

- [ ] **Step 4: Repositório, schema e serviço**

`back/src/http/api/integrations/integrations.repository.ts`:

```ts
import type { PrismaClient } from '@prisma/client';

/** Só o que a resposta e o conector precisam. O segredo sai em `find`, e `find` não é rota. */
const PUBLIC_SELECT = {
  id: true,
  provider: true,
  authKind: true,
  externalId: true,
  accountLabel: true,
  status: true,
  lastCheckedAt: true,
  lastError: true,
  createdAt: true,
} as const;

export function createIntegrationsRepository(prisma: PrismaClient) {
  return {
    /** Para a tela: nunca inclui o segredo, por `select` e não por confiança. */
    list(workspaceId: string) {
      return prisma.workspaceIntegration.findMany({
        where: { workspaceId },
        orderBy: { provider: 'asc' },
        select: PUBLIC_SELECT,
      });
    },
    /** Para o conector: inclui o segredo. Nenhum controller devolve isto direto. */
    find(workspaceId: string, provider: string) {
      return prisma.workspaceIntegration.findFirst({ where: { workspaceId, provider } });
    },
    upsert(input: {
      workspaceId: string;
      provider: string;
      authKind: string;
      ciphertext: Buffer;
      iv: Buffer;
      authTag: Buffer;
      externalId: string;
      accountLabel: string;
      createdBy: string;
      checkedAt: Date;
    }) {
      const { workspaceId, provider, createdBy, checkedAt, ...rest } = input;
      const verified = { ...rest, status: 'OK', lastError: null, lastCheckedAt: checkedAt };
      return prisma.workspaceIntegration.upsert({
        where: { workspaceId_provider: { workspaceId, provider } },
        create: { workspaceId, provider, createdBy, ...verified },
        update: verified,
        select: PUBLIC_SELECT,
      });
    },
    markFailed(id: string, reason: string, checkedAt: Date) {
      return prisma.workspaceIntegration.update({
        where: { id },
        data: { status: 'FAILED', lastError: reason, lastCheckedAt: checkedAt },
        select: PUBLIC_SELECT,
      });
    },
    remove(workspaceId: string, provider: string) {
      return prisma.workspaceIntegration.deleteMany({ where: { workspaceId, provider } });
    },
  };
}

export type IntegrationsRepository = ReturnType<typeof createIntegrationsRepository>;
```

`back/src/http/api/integrations/integrations.schema.ts`:

```ts
import { z } from 'zod';

export const integrationProvider = z.enum(['GA4']);
export const integrationAuthKind = z.enum(['SERVICE_ACCOUNT']);

/**
 * A resposta. Sem `ciphertext`, sem `iv`, sem `authTag`, sem credencial: o
 * schema é a segunda trava (a primeira é o `select` do repositório), e é a que
 * falha em build quando alguém acrescenta um campo por engano.
 */
export const integrationSchema = z.object({
  id: z.string(),
  provider: z.string(),
  authKind: z.string(),
  externalId: z.string(),
  accountLabel: z.string(),
  status: z.string(),
  lastCheckedAt: z.date().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.date(),
});

export const integrationResponse = z.object({ integration: integrationSchema });
export const integrationListResponse = z.object({ integrations: z.array(integrationSchema) });
export const integrationQuery = z.object({ provider: integrationProvider });
```

`back/src/http/api/integrations/integrations.service.ts`:

```ts
import { BadRequestError } from '../../../lib/errors.js';
import { open, seal } from '../../../billing/crypto.js';
import type { IntegrationsRepository } from './integrations.repository.js';

export type VerifyResult = { ok: true; accountLabel: string } | { ok: false; reason: string };

export type VerifyIntegration = (input: {
  provider: string;
  authKind: string;
  externalId: string;
  credentials: string;
}) => Promise<VerifyResult>;

export function createIntegrationsService(deps: { repo: IntegrationsRepository; verify: VerifyIntegration }) {
  return {
    list(workspaceId: string) {
      return deps.repo.list(workspaceId);
    },

    /**
     * Verificar antes de gravar, como `provider-key.service.ts` já faz: uma
     * credencial errada aceita em silêncio só apareceria como medição falhando
     * dias depois, sem pista do porquê.
     */
    async put(input: {
      workspaceId: string;
      provider: string;
      authKind: string;
      externalId: string;
      credentials: string;
      userId: string;
      now?: Date;
    }) {
      const verified = await deps.verify({
        provider: input.provider,
        authKind: input.authKind,
        externalId: input.externalId,
        credentials: input.credentials,
      });
      if (!verified.ok) {
        // A mensagem da própria fonte chega ao fundador: "Caller does not have
        // permission" diz o que fazer, "credencial inválida" não diz nada.
        throw new BadRequestError('The source refused this credential', [
          { path: 'credentials', message: verified.reason },
        ]);
      }

      return deps.repo.upsert({
        workspaceId: input.workspaceId,
        provider: input.provider,
        authKind: input.authKind,
        externalId: input.externalId,
        accountLabel: verified.accountLabel,
        createdBy: input.userId,
        checkedAt: input.now ?? new Date(),
        ...seal(input.credentials),
      });
    },

    async remove(workspaceId: string, provider: string) {
      await deps.repo.remove(workspaceId, provider);
    },
  };
}

/**
 * Único caminho que devolve a credencial em texto claro, para o conector.
 * Nenhuma rota chama isto — mesma regra do `reveal` do provider-key.
 */
export function openIntegrationCredential(row: { ciphertext: Uint8Array; iv: Uint8Array; authTag: Uint8Array }): string {
  return open({
    ciphertext: Buffer.from(row.ciphertext),
    iv: Buffer.from(row.iv),
    authTag: Buffer.from(row.authTag),
  });
}
```

- [ ] **Step 5: Verificador e controllers**

`back/src/http/api/integrations/verify-integration.ts`:

```ts
import { createGa4Provider, serviceAccountEmail, serviceAccountMinter } from '../../../integrations/analytics/index.js';
import type { VerifyIntegration } from './integrations.service.js';

/** Dez segundos: é uma chamada de metadata, não um relatório. */
const TIMEOUT_MS = 10_000;

/**
 * Uma leitura real contra a fonte, barata e rara (só na gravação). Espelha
 * `billing/verify-provider-key.ts`, e pela mesma razão.
 */
export const verifyIntegration: VerifyIntegration = async (input) => {
  if (input.provider !== 'GA4' || input.authKind !== 'SERVICE_ACCOUNT') {
    return { ok: false, reason: `unsupported integration: ${input.provider}/${input.authKind}` };
  }

  try {
    const provider = createGa4Provider({
      propertyId: input.externalId,
      mintToken: serviceAccountMinter(input.credentials),
    });
    await provider.health(AbortSignal.timeout(TIMEOUT_MS));
    return { ok: true, accountLabel: serviceAccountEmail(input.credentials) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'unknown error' };
  }
};
```

`back/src/http/api/integrations/list-integrations/list-integrations.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { assertAdmin } from '../../../../lib/tenant.js';
import { createIntegrationsRepository } from '../integrations.repository.js';
import { integrationListResponse } from '../integrations.schema.js';

export const listIntegrationsRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/integrations',
    {
      schema: {
        tags: ['integrations'],
        operationId: 'listIntegrations',
        response: { 200: integrationListResponse },
      },
    },
    async (req, reply) => {
      // Credencial de fonte externa é assunto de admin, como a chave de IA.
      assertAdmin(req.tenant);
      const integrations = await createIntegrationsRepository(app.prisma).list(req.tenant.workspaceId);
      return reply.send({ integrations });
    },
  );
};
```

`back/src/http/api/integrations/put-integration/put-integration.schema.ts`:

```ts
import { z } from 'zod';
import { integrationAuthKind, integrationProvider } from '../integrations.schema.js';

export const putIntegrationBody = z.object({
  provider: integrationProvider,
  authKind: integrationAuthKind,
  /** A property GA4. Só dígitos: o resto é erro de cópia, e um id errado vira 404 do Google. */
  externalId: z.string().regex(/^\d+$/, 'the GA4 property id is only digits').max(32),
  /** O JSON da service account, inteiro. Nunca volta em resposta nenhuma. */
  credentials: z.string().min(1).max(8192),
});

export type PutIntegrationBody = z.infer<typeof putIntegrationBody>;
```

`back/src/http/api/integrations/put-integration/put-integration.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { assertAdmin } from '../../../../lib/tenant.js';
import { createIntegrationsRepository } from '../integrations.repository.js';
import { integrationResponse } from '../integrations.schema.js';
import { createIntegrationsService, type VerifyIntegration } from '../integrations.service.js';
import { verifyIntegration } from '../verify-integration.js';
import { putIntegrationBody } from './put-integration.schema.js';

export const putIntegrationRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().put(
    '/integrations',
    {
      schema: {
        tags: ['integrations'],
        operationId: 'putIntegration',
        body: putIntegrationBody,
        response: { 200: integrationResponse },
      },
    },
    async (req, reply) => {
      assertAdmin(req.tenant);
      // `app.verifyIntegration` existe para o teste substituir a chamada real à
      // fonte; em produção nada o decora e o verificador real é usado.
      const verify = (app as unknown as { verifyIntegration?: VerifyIntegration }).verifyIntegration ?? verifyIntegration;
      const service = createIntegrationsService({ repo: createIntegrationsRepository(app.prisma), verify });

      const integration = await service.put({
        ...req.body,
        // O workspace vem do tenant. Um `workspaceId` no corpo é ignorado, não
        // respeitado.
        workspaceId: req.tenant.workspaceId,
        userId: req.tenant.userId,
      });

      return reply.send({ integration });
    },
  );
};
```

`back/src/http/api/integrations/remove-integration/remove-integration.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { assertAdmin } from '../../../../lib/tenant.js';
import { createIntegrationsRepository } from '../integrations.repository.js';
import { integrationQuery } from '../integrations.schema.js';
import { createIntegrationsService } from '../integrations.service.js';
import { verifyIntegration } from '../verify-integration.js';

export const removeIntegrationRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().delete(
    '/integrations',
    {
      schema: {
        tags: ['integrations'],
        operationId: 'removeIntegration',
        querystring: integrationQuery,
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      assertAdmin(req.tenant);
      const service = createIntegrationsService({
        repo: createIntegrationsRepository(app.prisma),
        verify: verifyIntegration,
      });
      // Sem integração, os experimentos amarrados voltam ao caminho manual: a
      // amarração sobrevive, e a proposta de medição passa a recusar por falta
      // de fonte. Nada de apagar binding em cascata aqui.
      await service.remove(req.tenant.workspaceId, req.query.provider);
      return reply.code(204).send();
    },
  );
};
```

`back/src/http/api/integrations/index.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import { listIntegrationsRoute } from './list-integrations/list-integrations.controller.js';
import { putIntegrationRoute } from './put-integration/put-integration.controller.js';
import { removeIntegrationRoute } from './remove-integration/remove-integration.controller.js';

export const integrationsRoutes: FastifyPluginAsync = async (app) => {
  await app.register(listIntegrationsRoute);
  await app.register(putIntegrationRoute);
  await app.register(removeIntegrationRoute);
};
```

Em `back/src/app.ts`, siga **exatamente** o padrão dos vizinhos: aplique os
`preHandler` de `authenticate` e `resolveTenant` no mesmo escopo em que as outras
rotas de recurso os aplicam, e registre `integrationsRoutes` ao lado de
`providerKeyController`. Leia o arquivo antes de editar — a ordem de plugins ali
é significativa.

- [ ] **Step 6: Rode e confirme que passa**

Run: `cd back && npx vitest run src/http/api/integrations/ && npx tsc --noEmit; echo "EXIT=$?"`
Expected: PASS, `EXIT=0`.

- [ ] **Step 7: Rode a suíte inteira e o contrato**

Run: `cd back && npx vitest run 2>&1 | tail -6 && pnpm openapi:dump`
Expected: nenhuma falha nova (baseline: 968 passando antes desta parte); `../web/api.json` com `listIntegrations`, `putIntegration`, `removeIntegration`.

- [ ] **Step 8: Stage e mostre para aprovação**

```bash
cd back
git add prisma/schema.prisma prisma/migrations/20260804120000_workspace_integration/ src/http/api/integrations/ src/app.ts
git status --short
git diff --cached --stat
cd ../web && git add api.json && git status --short
```

Mensagem sugerida (só depois do "ok"):

```
feat(integrations): connect a GA4 property to a workspace

Credencial selada no mesmo AES-256-GCM do BYOK e verificada contra a fonte antes
de ser gravada — uma credencial errada aceita em silêncio só apareceria como
medição falhando dias depois. A recusa carrega a mensagem do Google, que diz o que
fazer, em vez de "credencial inválida", que não diz nada.

O segredo não sai em resposta nenhuma, e a trava é dupla: `select` no repositório
e schema Zod na resposta. `status` fica guardado em vez de recalculado porque
health() é rede, e a lista não pode custar uma ida ao Google por render.

authKind discrimina SERVICE_ACCOUNT de OAUTH: o caminho OAuth depende de
verificação do app pelo Google e entra sem migrar dado quando sair.
```

---

## Task 3: Amarração do experimento

**Files:**
- Modify: `back/prisma/schema.prisma` (`MetricBinding` + relações em `Workspace` e `Experiment`)
- Create: `back/prisma/migrations/20260804130000_metric_binding/migration.sql`
- Create: `back/src/http/api/experiments/metric-binding.schema.ts`
- Create: `back/src/http/api/experiments/metric-binding.repository.ts`
- Create: `back/src/http/api/experiments/get-metric-binding/get-metric-binding.controller.ts`
- Create: `back/src/http/api/experiments/put-metric-binding/put-metric-binding.controller.ts`
- Create: `back/src/http/api/experiments/remove-metric-binding/remove-metric-binding.controller.ts`
- Modify: `back/src/http/api/experiments/index.ts`
- Modify: `back/src/http/api/write-guard.test.ts`
- Test: `back/src/http/api/experiments/metric-binding.test.ts`

**Interfaces:**
- Consumes: `ga4ConfigSchema` da Task 1; `experimentIdParam` de `experiments.schema.ts` (confirme o nome exato antes de importar).
- Produces:
  - `metricBindingSchema` / `metricBindingResponse` / `putMetricBindingBody`
  - `createMetricBindingRepository(prisma)` com `find(workspaceId, experimentId)`, `upsert(...)`, `remove(workspaceId, experimentId)`, `experimentInWorkspace(workspaceId, experimentId)`

- [ ] **Step 1: Escreva o teste que falha**

`back/src/http/api/experiments/metric-binding.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../lib/errors.js';
import { getMetricBindingRoute } from './get-metric-binding/get-metric-binding.controller.js';
import { putMetricBindingRoute } from './put-metric-binding/put-metric-binding.controller.js';
import { removeMetricBindingRoute } from './remove-metric-binding/remove-metric-binding.controller.js';

const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';
const EXPERIMENT_ID = '11111111-1111-1111-1111-111111111111';

const BINDING = {
  id: 'mb-1',
  workspaceId: WORKSPACE_ID,
  experimentId: EXPERIMENT_ID,
  provider: 'GA4',
  config: { metric: 'conversions', dimensionFilter: { fieldName: 'eventName', value: 'sign_up' } },
  createdBy: 'u1',
  createdAt: new Date('2026-08-04T00:00:00.000Z'),
  updatedAt: new Date('2026-08-04T00:00:00.000Z'),
};

const prismaFake = (over: { experiment?: unknown; binding?: unknown } = {}) => ({
  experiment: { findFirst: vi.fn().mockResolvedValue(over.experiment ?? { id: EXPERIMENT_ID }) },
  metricBinding: {
    findFirst: vi.fn().mockResolvedValue('binding' in over ? over.binding : BINDING),
    upsert: vi.fn().mockResolvedValue(BINDING),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
});

beforeEach(() => vi.clearAllMocks());

async function buildApp(prisma: unknown, role: 'MEMBER' | 'VIEWER' = 'MEMBER') {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prisma as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: WORKSPACE_ID, role };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
    throw error;
  });
  await app.register(getMetricBindingRoute);
  await app.register(putMetricBindingRoute);
  await app.register(removeMetricBindingRoute);
  return app;
}

const url = `/experiments/${EXPERIMENT_ID}/metric-binding`;

describe('GET /experiments/:id/metric-binding', () => {
  it('devolve a amarração do experimento', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({ method: 'GET', url });

    expect(res.statusCode).toBe(200);
    expect(res.json().binding).toMatchObject({ provider: 'GA4', config: { metric: 'conversions' } });
  });

  // Sem amarração o experimento continua no caminho manual. 404 é a resposta
  // honesta: não existe amarração, e a tela decide o que oferecer.
  it('404 quando o experimento não tem amarração', async () => {
    const app = await buildApp(prismaFake({ binding: null }));

    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
  });

  it('404 para experimento de outro workspace', async () => {
    const app = await buildApp(prismaFake({ experiment: null, binding: null }));

    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
  });

  it('lê com o workspace do tenant', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    await app.inject({ method: 'GET', url });

    expect(prisma.metricBinding.findFirst).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, experimentId: EXPERIMENT_ID },
    });
  });
});

describe('PUT /experiments/:id/metric-binding', () => {
  const body = { provider: 'GA4', config: { metric: 'conversions' } };

  it('grava a amarração', async () => {
    const prisma = prismaFake({ binding: null });
    const app = await buildApp(prisma);

    const res = await app.inject({ method: 'PUT', url, payload: body });

    expect(res.statusCode).toBe(200);
    expect(prisma.metricBinding.upsert).toHaveBeenCalled();
  });

  // Json livre no banco não pode ser Json livre na entrada: uma amarração
  // malformada só falharia na hora de medir, e o erro chegaria disfarçado de
  // problema da fonte.
  it('recusa uma config que não é uma amarração GA4 válida', async () => {
    const app = await buildApp(prismaFake({ binding: null }));

    expect((await app.inject({ method: 'PUT', url, payload: { provider: 'GA4', config: {} } })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: 'PUT', url, payload: { provider: 'GA4', config: { metric: '' } } })).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url,
          payload: { provider: 'GA4', config: { metric: 'conversions', dimensionFilter: { fieldName: 'eventName' } } },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('404 para experimento de outro workspace, sem gravar', async () => {
    const prisma = prismaFake({ experiment: null, binding: null });
    const app = await buildApp(prisma);

    expect((await app.inject({ method: 'PUT', url, payload: body })).statusCode).toBe(404);
    expect(prisma.metricBinding.upsert).not.toHaveBeenCalled();
  });

  it('nega VIEWER', async () => {
    const app = await buildApp(prismaFake({ binding: null }), 'VIEWER');

    expect((await app.inject({ method: 'PUT', url, payload: body })).statusCode).toBe(403);
  });
});

describe('DELETE /experiments/:id/metric-binding', () => {
  it('remove só dentro do workspace', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    const res = await app.inject({ method: 'DELETE', url });

    expect(res.statusCode).toBe(204);
    expect(prisma.metricBinding.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, experimentId: EXPERIMENT_ID },
    });
  });

  it('nega VIEWER', async () => {
    const app = await buildApp(prismaFake(), 'VIEWER');

    expect((await app.inject({ method: 'DELETE', url })).statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `cd back && npx vitest run src/http/api/experiments/metric-binding.test.ts`
Expected: FAIL — imports não resolvem.

- [ ] **Step 3: Modelo e migração**

Em `back/prisma/schema.prisma`:

```prisma
/// De onde vem o número deste experimento.
///
/// 1:1 com o experimento hoje. `Experiment.metric` é texto livre — é o que o
/// fundador chama de métrica — e nenhum código pode derivar dali uma consulta na
/// fonte. Esta linha é a declaração humana que fecha essa lacuna, do mesmo jeito
/// que baseline e target são declarações humanas.
///
/// Promoção futura a catálogo de workspace (analytics.md §8-9): relaxar o
/// @unique e tornar experimentId nulável.
model MetricBinding {
  id           String   @id @default(uuid())
  workspaceId  String
  experimentId String   @unique
  /// 'GA4' hoje.
  provider     String
  /// Config específica da fonte. GA4: { metric, dimensionFilter? }. Validada por
  /// schema Zod por provider antes de gravar.
  config       Json
  createdBy    String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  workspace  Workspace  @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  experiment Experiment @relation(fields: [experimentId], references: [id], onDelete: Cascade)

  @@index([workspaceId])
}
```

Em `model Workspace`: `metricBindings MetricBinding[]`.
Em `model Experiment`: `metricBinding MetricBinding?`.

`back/prisma/migrations/20260804130000_metric_binding/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "MetricBinding" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetricBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MetricBinding_experimentId_key" ON "MetricBinding"("experimentId");

-- CreateIndex
CREATE INDEX "MetricBinding_workspaceId_idx" ON "MetricBinding"("workspaceId");

-- AddForeignKey
ALTER TABLE "MetricBinding" ADD CONSTRAINT "MetricBinding_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricBinding" ADD CONSTRAINT "MetricBinding_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

```bash
cd back && npx prisma migrate deploy && npx prisma generate && npx prisma migrate status
```

- [ ] **Step 4: Schema, repositório e controllers**

`back/src/http/api/experiments/metric-binding.schema.ts`:

```ts
import { z } from 'zod';
import { ga4ConfigSchema } from '../../../integrations/analytics/index.js';

export const metricBindingProvider = z.enum(['GA4']);

/**
 * A config é validada por provider. O banco guarda Json, a entrada não é livre:
 * uma amarração malformada só falharia na hora de medir, e o erro chegaria
 * disfarçado de problema da fonte.
 */
export const putMetricBindingBody = z.object({
  provider: metricBindingProvider,
  config: ga4ConfigSchema,
});

export const metricBindingSchema = z.object({
  id: z.string(),
  experimentId: z.string(),
  provider: z.string(),
  config: z.unknown(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const metricBindingResponse = z.object({ binding: metricBindingSchema });
```

`back/src/http/api/experiments/metric-binding.repository.ts`:

```ts
import type { PrismaClient, Prisma } from '@prisma/client';

export function createMetricBindingRepository(prisma: PrismaClient) {
  return {
    /** O experimento existe neste workspace? Um de outro é indistinguível de inexistente. */
    experimentInWorkspace(workspaceId: string, experimentId: string) {
      return prisma.experiment.findFirst({ where: { id: experimentId, workspaceId }, select: { id: true } });
    },
    find(workspaceId: string, experimentId: string) {
      return prisma.metricBinding.findFirst({ where: { workspaceId, experimentId } });
    },
    upsert(input: {
      workspaceId: string;
      experimentId: string;
      provider: string;
      config: Prisma.InputJsonValue;
      createdBy: string;
    }) {
      const { workspaceId, experimentId, createdBy, ...rest } = input;
      return prisma.metricBinding.upsert({
        where: { experimentId },
        create: { workspaceId, experimentId, createdBy, ...rest },
        update: rest,
      });
    },
    remove(workspaceId: string, experimentId: string) {
      return prisma.metricBinding.deleteMany({ where: { workspaceId, experimentId } });
    },
  };
}

export type MetricBindingRepository = ReturnType<typeof createMetricBindingRepository>;
```

Os três controllers seguem o mesmo esqueleto. `get`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { NotFoundError } from '../../../../lib/errors.js';
import { experimentIdParam } from '../experiments.schema.js';
import { createMetricBindingRepository } from '../metric-binding.repository.js';
import { metricBindingResponse } from '../metric-binding.schema.js';

export const getMetricBindingRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/experiments/:id/metric-binding',
    {
      schema: {
        tags: ['experiments'],
        operationId: 'getMetricBinding',
        params: experimentIdParam,
        response: { 200: metricBindingResponse },
      },
    },
    async (req, reply) => {
      const repo = createMetricBindingRepository(app.prisma);
      const binding = await repo.find(req.tenant.workspaceId, req.params.id);
      // Sem amarração, 404: não existe, e a tela decide se oferece o agente ou o
      // formulário. Nunca um objeto vazio fingindo amarração.
      if (!binding) throw new NotFoundError('Metric binding not found');
      return reply.send({ binding });
    },
  );
};
```

`put` — confirme o experimento primeiro, escreva depois, e chame `assertWriter`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { NotFoundError } from '../../../../lib/errors.js';
import { assertWriter } from '../../../../lib/tenant.js';
import { experimentIdParam } from '../experiments.schema.js';
import { createMetricBindingRepository } from '../metric-binding.repository.js';
import { metricBindingResponse, putMetricBindingBody } from '../metric-binding.schema.js';

export const putMetricBindingRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().put(
    '/experiments/:id/metric-binding',
    {
      schema: {
        tags: ['experiments'],
        operationId: 'putMetricBinding',
        params: experimentIdParam,
        body: putMetricBindingBody,
        response: { 200: metricBindingResponse },
      },
    },
    async (req, reply) => {
      assertWriter(req.tenant);
      const repo = createMetricBindingRepository(app.prisma);
      const experiment = await repo.experimentInWorkspace(req.tenant.workspaceId, req.params.id);
      if (!experiment) throw new NotFoundError('Experiment not found');

      const binding = await repo.upsert({
        workspaceId: req.tenant.workspaceId,
        experimentId: req.params.id,
        provider: req.body.provider,
        config: req.body.config,
        createdBy: req.tenant.userId,
      });

      return reply.send({ binding });
    },
  );
};
```

`remove` — `assertWriter`, `deleteMany` por workspace + experimento, `204`
com `response: { 204: z.void() }`, sem 404 quando não havia nada: remover o que
não existe deixa o mundo no estado pedido.

Registre as três em `back/src/http/api/experiments/index.ts`, ao lado das que já
estão lá.

- [ ] **Step 5: Acrescente as rotas ao write-guard**

Em `back/src/http/api/write-guard.test.ts`, na lista de rotas de escrita:

```ts
  { method: 'PUT', url: '/experiments/11111111-1111-1111-1111-111111111111/metric-binding', payload: { provider: 'GA4', config: { metric: 'conversions' } } },
  { method: 'DELETE', url: '/experiments/11111111-1111-1111-1111-111111111111/metric-binding' },
```

Leia o arquivo antes: a lista tem um formato próprio e o mock de Prisma dele
precisa conhecer `metricBinding`.

- [ ] **Step 6: Rode e confirme que passa**

Run: `cd back && npx vitest run src/http/api/experiments/ src/http/api/write-guard.test.ts && npx tsc --noEmit; echo "EXIT=$?"`
Expected: PASS, `EXIT=0`.

- [ ] **Step 7: Suíte inteira e contrato**

Run: `cd back && npx vitest run 2>&1 | tail -6 && pnpm openapi:dump`
Expected: nenhuma falha nova; `api.json` com `getMetricBinding`, `putMetricBinding`, `removeMetricBinding`.

- [ ] **Step 8: Stage e mostre para aprovação**

```bash
cd back
git add prisma/schema.prisma prisma/migrations/20260804130000_metric_binding/ src/http/api/experiments/ src/http/api/write-guard.test.ts
git status --short
git diff --cached --stat
cd ../web && git add api.json && git status --short
```

Mensagem sugerida (só depois do "ok"):

```
feat(experiments): let an experiment say where its number comes from

`Experiment.metric` é texto livre — é como o fundador chama a métrica dele — e
nenhum código pode derivar dali uma consulta no GA4. MetricBinding é a declaração
humana que fecha essa lacuna, na mesma classe de baseline e target: origem de
número não se infere.

A config é Json no banco e não é Json na entrada: `ga4ConfigSchema` valida antes
de gravar, porque uma amarração malformada só falharia na hora de medir e o erro
chegaria disfarçado de problema da fonte.

Sem amarração nada muda: o experimento segue no fluxo manual, o dashboard cobra e
o fundador digita. A adoção é por experimento.
```

---

## Task 4: O agente que propõe a amarração

**Files:**
- Create: `back/src/ai/tools/list-source-metrics.ts`
- Create: `back/src/ai/tools/list-source-metrics.test.ts`
- Create: `back/src/ai/agents/fill/propose-metric-binding.ts`
- Create: `back/src/ai/agents/fill/propose-metric-binding.test.ts`
- Modify: `back/src/ai/agents/registry.ts`
- Modify: `back/src/billing/operation-cost.ts`

**Interfaces:**
- Consumes: `Tool`/`ToolContext` de `src/ai/tools/tool.js`; `createGetExperimentResultTool` de `src/ai/tools/get-experiment-result.js` (já devolve `metric`, `objective`, `channel`, `audience` — **não crie uma tool nova para isso**); `createIntegrationsRepository` + `openIntegrationCredential` da Task 2; `createGa4Provider` + `serviceAccountMinter` da Task 1; `AgentDefinition` de `src/ai/agents/registry.js`.
- Produces:
  - `createListSourceMetricsTool(): Tool<{}>` — nome `list_source_metrics`
  - `proposeMetricBindingAgent: AgentDefinition<{ experimentId: string }, ProposeMetricBindingOutput>`
  - `taskType: 'propose-metric-binding'`, custo **1**

- [ ] **Step 1: Escreva o teste da tool**

`back/src/ai/tools/list-source-metrics.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createListSourceMetricsTool } from './list-source-metrics.js';

const TENANT = { userId: 'u1', organizationId: 'org-1', workspaceId: 'ws-1', role: 'MEMBER' as const };

const integration = {
  id: 'int-1',
  provider: 'GA4',
  authKind: 'SERVICE_ACCOUNT',
  externalId: '123',
  ciphertext: Buffer.from('c'),
  iv: Buffer.from('i'),
  authTag: Buffer.from('t'),
};

const ctx = (integrationRow: unknown) => ({
  tenant: TENANT,
  prisma: { workspaceIntegration: { findFirst: vi.fn().mockResolvedValue(integrationRow) } } as never,
  signal: AbortSignal.timeout(5_000),
});

/** O minter injetado: assinar JWT de verdade exigiria uma chave real. */
const fakeMinter = () => async () => 'fake-token';

function stubMetadata(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
    ),
  );
}

/** `openIntegrationCredential` é exercitado de verdade: o segredo é selado aqui. */
function sealedIntegration() {
  const sealed = seal(JSON.stringify({ client_email: 'aurea@p.iam.gserviceaccount.com', private_key: 'pk' }));
  return { ...integration, ...sealed };
}

afterEach(() => vi.unstubAllGlobals());

describe('list_source_metrics', () => {
  // Erro devolvido, não lançado: o run continua e o agente pode dizer que não há
  // fonte, em vez de morrer FAILED com o crédito já gasto.
  it('diz que não há fonte conectada em vez de falhar o run', async () => {
    const result = await createListSourceMetricsTool({ mintToken: fakeMinter }).execute({}, ctx(null));

    expect(result).toEqual({ error: 'no analytics source is connected to this workspace' });
  });

  it('devolve as métricas e dimensões da property', async () => {
    stubMetadata({
      metrics: [{ apiName: 'conversions', uiName: 'Conversions', description: 'Conversion events.' }],
      dimensions: [{ apiName: 'eventName', uiName: 'Event name', description: 'The name of the event.' }],
    });

    const result = (await createListSourceMetricsTool({ mintToken: fakeMinter }).execute(
      {},
      ctx(sealedIntegration()),
    )) as { propertyId: string; metrics: { apiName: string }[]; omitted: { metrics: number } };

    expect(result.propertyId).toBe('123');
    expect(result.metrics[0].apiName).toBe('conversions');
    expect(result.omitted.metrics).toBe(0);
  });

  // O corte não pode ser silencioso: um modelo que não vê a métrica certa e não
  // sabe que ela existe propõe a mais parecida com convicção.
  it('declara quantas métricas ficaram fora do corte', async () => {
    stubMetadata({
      metrics: Array.from({ length: 95 }, (_, i) => ({ apiName: `m${i}`, uiName: `M ${i}` })),
      dimensions: [],
    });

    const result = (await createListSourceMetricsTool({ mintToken: fakeMinter }).execute(
      {},
      ctx(sealedIntegration()),
    )) as { metrics: unknown[]; omitted: { metrics: number } };

    expect(result.metrics).toHaveLength(80);
    expect(result.omitted.metrics).toBe(15);
  });

  // As customizadas primeiro: é onde vive o vocabulário do próprio negócio.
  it('põe as métricas customizadas na frente do corte', async () => {
    stubMetadata({
      metrics: [
        ...Array.from({ length: 80 }, (_, i) => ({ apiName: `m${i}`, uiName: `M ${i}`, customDefinition: false })),
        { apiName: 'customEvent:activated', uiName: 'Activated', customDefinition: true },
      ],
      dimensions: [],
    });

    const result = (await createListSourceMetricsTool({ mintToken: fakeMinter }).execute(
      {},
      ctx(sealedIntegration()),
    )) as { metrics: { apiName: string }[] };

    expect(result.metrics[0].apiName).toBe('customEvent:activated');
  });

  it('devolve a mensagem da fonte quando a leitura falha', async () => {
    stubMetadata({ error: { message: 'Caller does not have permission.' } }, 403);

    const result = await createListSourceMetricsTool({ mintToken: fakeMinter }).execute({}, ctx(sealedIntegration()));

    expect(result).toEqual({ error: 'Caller does not have permission.' });
  });
});
```

O import do `seal` vem de `../../billing/crypto.js`. A chave de cifra já vem do
ambiente de teste — `vitest.config.ts:13` define `AI_KEY_ENCRYPTION_KEY` para toda
a suíte, então não há setup a escrever.

- [ ] **Step 2: Escreva a tool**

`back/src/ai/tools/list-source-metrics.ts`:

```ts
import { z } from 'zod';
import type { Tool, ToolContext } from './tool.js';
import {
  createGa4Provider,
  serviceAccountMinter,
  type MetricDescriptor,
} from '../../integrations/analytics/index.js';
import { createIntegrationsRepository } from '../../http/api/integrations/integrations.repository.js';
import { openIntegrationCredential } from '../../http/api/integrations/integrations.service.js';

// Sem argumentos: a fonte é a do workspace do run, nunca escolhida pelo modelo.
const argsSchema = z.object({});
type Args = z.infer<typeof argsSchema>;

/**
 * Um teto de prompt, e ele é declarado: 200 métricas e 200 dimensões com
 * descrição passam de 20 mil tokens. O corte não é silencioso — a saída diz
 * quantas ficaram fora, porque um modelo que não vê a métrica certa e não sabe
 * que ela existe propõe a mais parecida com convicção.
 */
const LIMIT = 80;

function trim(all: MetricDescriptor[]): { items: MetricDescriptor[]; omitted: number } {
  // As customizadas primeiro: é onde vive o vocabulário do próprio negócio, e é
  // o que o fundador tem mais chance de estar medindo.
  const ordered = [...all].sort((a, b) => Number(b.custom) - Number(a.custom));
  return { items: ordered.slice(0, LIMIT), omitted: Math.max(0, ordered.length - LIMIT) };
}

export function createListSourceMetricsTool(deps: { mintToken?: (credentials: string) => () => Promise<string> } = {}): Tool<Args> {
  const minter = deps.mintToken ?? serviceAccountMinter;

  return {
    name: 'list_source_metrics',
    description:
      'Returns the metrics and dimensions the connected analytics property actually has, including the ones this business defined itself. Call this before proposing a binding: a metric that is not in this list cannot be read.',
    argsSchema,
    async execute(_args: Args, ctx: ToolContext) {
      const row = await createIntegrationsRepository(ctx.prisma).find(ctx.tenant.workspaceId, 'GA4');
      // Um erro devolvido, e não lançado: o run continua e o agente pode dizer
      // que não há fonte, em vez de morrer FAILED com o crédito gasto.
      if (!row) return { error: 'no analytics source is connected to this workspace' };

      try {
        const provider = createGa4Provider({
          propertyId: row.externalId,
          mintToken: minter(openIntegrationCredential(row)),
        });
        const { metrics, dimensions } = await provider.listMetrics(ctx.signal);
        const m = trim(metrics);
        const d = trim(dimensions);
        return {
          propertyId: row.externalId,
          metrics: m.items,
          dimensions: d.items,
          omitted: { metrics: m.omitted, dimensions: d.omitted },
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'could not read the source metadata' };
      }
    },
  };
}
```

- [ ] **Step 3: Escreva o teste do agente**

`back/src/ai/agents/fill/propose-metric-binding.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { proposeMetricBindingAgent } from './propose-metric-binding.js';
import { creditCost } from '../../../billing/operation-cost.js';

describe('propose-metric-binding', () => {
  it('custa um crédito, como os outros preenchimentos de um campo', () => {
    expect(creditCost(proposeMetricBindingAgent.taskType)).toBe(1);
  });

  it('pede as duas fontes de verdade antes de responder', () => {
    const tools = proposeMetricBindingAgent.buildTools({ experimentId: '11111111-1111-1111-1111-111111111111' });

    expect(tools.map((tool) => tool.name)).toEqual(['get_experiment_result', 'list_source_metrics']);
  });

  it('aceita uma proposta com métrica e filtro', () => {
    const parsed = proposeMetricBindingAgent.outputSchema.safeParse({
      binding: { metric: 'conversions', dimensionFilter: { fieldName: 'eventName', value: 'sign_up' } },
      rationale: 'A métrica do teste é cadastro concluído, e o evento sign_up é o que a property registra.',
    });

    expect(parsed.success).toBe(true);
  });

  it('aceita uma proposta sem filtro', () => {
    expect(
      proposeMetricBindingAgent.outputSchema.safeParse({
        binding: { metric: 'sessions', dimensionFilter: null },
        rationale: 'Sessões do período, sem filtro.',
      }).success,
    ).toBe(true);
  });

  // A trava que mais importa: nenhuma métrica plausível é uma resposta, não uma
  // falha. Uma amarração errada não erra um campo — erra todos os números
  // daquele experimento para sempre, e chega disfarçada de dado.
  it('aceita "nenhuma serve" com o motivo, e exige o motivo', () => {
    expect(
      proposeMetricBindingAgent.outputSchema.safeParse({
        binding: null,
        rationale: 'A property não tem nenhuma métrica de resposta a e-mail; isto se mede no provedor de e-mail.',
      }).success,
    ).toBe(true);

    expect(proposeMetricBindingAgent.outputSchema.safeParse({ binding: null }).success).toBe(false);
    expect(proposeMetricBindingAgent.outputSchema.safeParse({ binding: null, rationale: '' }).success).toBe(false);
  });

  it('recusa campo extra na amarração', () => {
    expect(
      proposeMetricBindingAgent.outputSchema.safeParse({
        binding: { metric: 'conversions', propertyId: '999' },
        rationale: 'x',
      }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 4: Escreva o agente**

`back/src/ai/agents/fill/propose-metric-binding.ts`:

```ts
import { z } from 'zod';
import type { AgentContext, AgentDefinition } from '../registry.js';
import { createGetExperimentResultTool } from '../../tools/get-experiment-result.js';
import { createListSourceMetricsTool } from '../../tools/list-source-metrics.js';
import type { Tool } from '../../tools/tool.js';
import type { AiMessage } from '../../providers/provider.js';
import { NotFoundError } from '../../../lib/errors.js';

const inputSchema = z.object({ experimentId: z.string().uuid() });
type Input = z.infer<typeof inputSchema>;

const outputSchema = z
  .object({
    /**
     * Null quando nenhuma métrica da property responde pela métrica do
     * experimento. É resposta, não falha — e a alternativa (escolher a mais
     * parecida) erra todos os números daquele experimento para sempre.
     */
    binding: z
      .object({
        metric: z.string().min(1).max(160),
        dimensionFilter: z
          .object({ fieldName: z.string().min(1).max(160), value: z.string().min(1).max(200) })
          .nullable()
          .default(null),
      })
      .strict()
      .nullable(),
    /** Obrigatório nos dois casos: sem motivo, o humano não tem o que conferir. */
    rationale: z.string().min(1).max(1000),
  })
  .strict();

export type ProposeMetricBindingOutput = z.infer<typeof outputSchema>;

const SYSTEM = [
  'You are a growth analyst for AUREA.',
  'Your job: say which metric of the connected analytics property answers for this experiment’s metric.',
  'Call get_experiment_result and list_source_metrics before answering. They are your only sources.',
  'The experiment’s `metric` is free text written by the founder. Your job is to map it, not to judge it.',
  'metric: must be an apiName that list_source_metrics returned. A metric that is not in that list cannot be read, and naming one is worse than naming none.',
  'dimensionFilter: only when the metric alone would count more than the experiment measures — for example eventCount filtered to one eventName. Otherwise null.',
  'If the property has no metric that answers for this experiment, return binding: null and say in rationale where that number would have to come from instead. Never pick the closest-looking metric.',
  'If list_source_metrics reported omitted metrics, say so in rationale: the founder may need to look for one you could not see.',
  'rationale: one short paragraph, addressed to the founder, in the language of the experiment.',
].join('\n');

export const proposeMetricBindingAgent: AgentDefinition<Input, ProposeMetricBindingOutput> = {
  taskType: 'propose-metric-binding',
  agentType: 'analyst',
  tier: 'TIER1',
  // Uma leitura do experimento, uma da property, uma resposta curta. O teto de
  // saída sai do próprio schema (ai/runner/output-budget.ts).
  budget: { maxToolIterations: 4, maxModelCalls: 5, maxOutputTokens: 2048 },
  requiresSearch: false,
  inputSchema,
  outputSchema,

  buildTools(input: Input): readonly Tool<never>[] {
    return [
      createGetExperimentResultTool(input.experimentId) as unknown as Tool<never>,
      createListSourceMetricsTool() as unknown as Tool<never>,
    ];
  },

  buildMessages(_input: Input, _ctx: AgentContext): AiMessage[] {
    return [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: 'Which metric of my analytics property should measure this experiment?' },
    ];
  },

  async precheck(input, { prisma, tenant }) {
    const experiment = await prisma.experiment.findFirst({
      where: { id: input.experimentId, workspaceId: tenant.workspaceId },
      select: { id: true },
    });
    if (!experiment) throw new NotFoundError('Experiment not found');
    // Sem fonte conectada não há o que propor, e recusar aqui é recusar antes de
    // cobrar o crédito — é para isso que o precheck existe.
    const integration = await prisma.workspaceIntegration.findFirst({
      where: { workspaceId: tenant.workspaceId, provider: 'GA4' },
      select: { id: true },
    });
    if (!integration) throw new NotFoundError('No analytics source is connected');
  },
};
```

- [ ] **Step 5: Registre e precifique**

Em `back/src/ai/agents/registry.ts`: importe `proposeMetricBindingAgent` e
acrescente-o ao `AGENT_REGISTRY` como os vizinhos.

Em `back/src/billing/operation-cost.ts`, dentro de `CREDITS_BY_TASK`:

```ts
  // Uma leitura do experimento, uma da property, uma resposta curta: a mesma
  // âncora de esforço percebido dos outros preenchimentos de um campo.
  'propose-metric-binding': 1,
```

- [ ] **Step 6: Rode tudo**

Run: `cd back && npx vitest run src/ai/ && npx tsc --noEmit; echo "EXIT=$?"`
Expected: PASS, `EXIT=0`. O teste de `output-budget` que percorre o registro passa
a cobrir o agente novo — se ele reclamar que o teto é menor que o pior caso do
schema, **suba o teto no agente**, não afrouxe o teste.

- [ ] **Step 7: Suíte inteira e contrato**

Run: `cd back && npx vitest run 2>&1 | tail -6 && pnpm openapi:dump`
Expected: nenhuma falha nova. O `api.json` muda se o catálogo de operações
(`/credits/pricing`) expuser a lista de task types.

- [ ] **Step 8: Stage e mostre para aprovação**

```bash
cd back
git add src/ai/ src/billing/operation-cost.ts
git status --short
git diff --cached --stat
cd ../web && git add api.json && git status --short
```

Mensagem sugerida (só depois do "ok"):

```
feat(ai): propose which source metric measures an experiment

O fundador conhece "taxa de conversão", não `conversions` filtrado por
`eventName == sign_up`. O agente lê o experimento e as métricas que a property
realmente tem — as customizadas primeiro, porque é onde vive o vocabulário do
próprio negócio — e propõe a amarração. Confirmar continua humano: amarração é
proveniência.

Duas travas no schema: `metric` tem de ser um apiName que a tool devolveu, e
`binding: null` com motivo é uma resposta válida. Escolher a métrica mais parecida
não erra um campo — erra todos os números daquele experimento para sempre, e chega
disfarçado de dado.

O corte da lista de métricas é declarado na saída da tool (`omitted`), porque um
modelo que não vê a métrica certa e não sabe que ela existe propõe a mais parecida
com convicção.
```

---

## Ordem e dependências

```text
Task 1 (conector)
   ├──────────────┐
   ↓              ↓
Task 2 (credencial)   Task 3 (amarração — só precisa do ga4ConfigSchema)
   └──────┬───────┘
          ↓
     Task 4 (agente: precisa da tool, que precisa de 1 e 2)
```

Task 3 depende apenas do `ga4ConfigSchema` da Task 1 e pode ser feita em paralelo
com a Task 2 se necessário — mas as duas mexem em `prisma/schema.prisma`, então
executá-las em sequência evita conflito de migração.

## Self-review

**Cobertura do spec** (§3-6, §11, §12 passos 1-3):

| Seção | Task |
|---|---|
| §3 três operações, com a razão de cada ausência | Task 1 |
| §3.1 runReport, metadata, UTC, `metricAggregations`, dependência | Task 1 |
| §4 modelo selado, status guardado, segredo fora da resposta | Task 2 |
| §4.1 `authKind` como discriminador, service account primeiro | Task 2 |
| §5 `MetricBinding`, config validada por provider, sem binding nada muda | Task 3 |
| §6 agente, duas travas, custo 1, teto do schema | Task 4 |
| §9 erros (401/404/zero/malformado/credencial) | Tasks 1 e 2 |
| §11 testes | distribuídos, um bloco por task |

Fora deste plano, por serem Parte B: §7 (`measurement-proposal`), §8 (proveniência
no `Outcome` e `fromSource`), e todas as telas.

**Sem placeholders:** todo passo traz o código que precisa ser escrito. A única
instrução que delega decisão ao implementador é a ordem de plugins em `src/app.ts`
(Task 2, Step 5) e o formato da lista do `write-guard.test.ts` (Task 3, Step 5),
nos dois casos com o comando de ler o arquivo antes de editar — ditar de fora a
ordem de registro de plugins é como se quebra a resolução de tenant.

**Consistência de tipos:** `Ga4Config` (Task 1) é o mesmo schema que
`putMetricBindingBody.config` usa (Task 3) e o mesmo que `readMetric` valida —
uma definição, três usos. `MetricDescriptor` (Task 1) é o que a tool devolve
(Task 4). `openIntegrationCredential` recebe `Uint8Array` porque é o que o Prisma
devolve para `Bytes`, e converte para `Buffer` internamente.

**Risco conhecido:** `app.decorate('verifyIntegration', ...)` nos testes é um
ponto de injeção via decorator em vez de dependência de construtor — menos limpo
que o `startRun` de `plan-experiments`, mas o controller de `PUT /integrations`
não tem serviço montado por quem chama. Se o implementador preferir passar o
verificador por parâmetro do plugin (`putIntegrationRoute(app, { verify })`),
é uma melhoria, não um desvio.

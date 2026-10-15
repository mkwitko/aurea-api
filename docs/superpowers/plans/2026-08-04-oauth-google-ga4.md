# Conexão por OAuth Google (GA4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar uma property do GA4 com um clique e uma escolha de nome, mantendo o caminho de service account funcionando intacto ao lado.

**Architecture:** O `authKind` da Parte A era o ponto de extensão, e ele paga aqui: `createGa4Provider` recebe `mintToken: () => Promise<string>` e não muda. Entra um segundo cunhador (`oauthMinter`, com `OAuth2Client`) e um seletor (`minterFor`) que os três chamadores atuais passam a usar. O fluxo tem quatro rotas — autorizar, callback público, listar properties, escolher property — porque no instante do callback ninguém sabe qual property, e a escolha é humana. `externalId` passa a ser nulável para representar o intervalo entre autorizar e escolher, em vez de um valor-sentinela.

**Tech Stack:** Node 22, Fastify 5, TypeScript strict ESM (`.js` nos imports), Zod 3 + `fastify-type-provider-zod`, Prisma 6 + PostgreSQL, `google-auth-library` ^11 (já instalada), Vitest. Web: Vite + React 19, Tailwind + shadcn/ui, Kubb + React Query, i18next pt/en/es.

**Spec:** `docs/superpowers/specs/2026-08-04-oauth-google-ga4-design.md`

## Global Constraints

Copiadas do spec e das regras do repositório. Valem em **toda** task.

- **Escopos:** `https://www.googleapis.com/auth/analytics.readonly`, `openid`, `email`. Nada pede escopo de escrita, em nenhum produto Google. Um token que pode escrever numa property é um token que pode apagar a medição do cliente.
- **O segredo nunca sai numa resposta.** Nenhuma rota devolve `ciphertext`, `iv`, `authTag`, `refresh_token`, `access_token` nem `code`. `openIntegrationCredential` é o único caminho para texto claro e nenhum controller o chama direto.
- **Nada do callback entra na URL de volta** além de `google=connected|error` e um `reason` de vocabulário fechado (`/^[a-z_]{1,40}$/`, senão `unknown`). Código de autorização e token não passam por query string de redirect nem por log.
- **O workspace vem do `state` assinado**, nunca de query string, body ou header no callback. Em toda rota autenticada, de `req.tenant`.
- **`state` é um JWT com `purpose: 'google-oauth'` e sem `sub`.** O `purpose` impede um access token de servir como state; a ausência de `sub` impede um state de servir como Bearer. TTL 10 minutos.
- **Sem `refresh_token` na resposta do Google, não grava.** Guardar só o access token seria uma conexão que morre em uma hora e volta como "medição falhou" dias depois.
- **Uma conexão por fonte por workspace.** `@@unique([workspaceId, provider])` continua. Conectar por um caminho substitui o outro.
- **OAuth não configurado é estado legítimo, não erro de boot.** Sem as três variáveis de env, o botão de Google não existe e a service account funciona igual.
- **NEVER `prisma migrate dev`, NEVER `migrate reset`.** `migration.sql` à mão + `pnpm prisma:deploy`. Drift de checksum ⇒ pare e reporte.
- **Nenhum teste toca a rede.** `fetch` stubado, `OAuth2Client` injetado por parâmetro, navegação do browser stubada no web. Nada de decorator ambiente para injetar isso.
- **Commit exige aprovação explícita.** Cada task termina em `git add` + `git status` + diff resumido; **não rode `git commit` sem o "ok" do humano.**
- **Tailwind + shadcn/ui apenas** no web. Sem CSS puro, sem `style={{}}`. Todo termo de domínio novo ganha `Help`.
- **i18n nas três línguas sempre.** `src/i18n/locales.test.ts` compara as chaves de `en`/`pt`/`es`.

---

## File Structure

### Backend

| arquivo | responsabilidade |
|---|---|
| `src/config/env.ts` (modificar) | três variáveis novas + refine cruzado (as três juntas ou nenhuma) |
| `src/integrations/analytics/ga4/ga4-token.ts` (modificar) | `oauthMinter` ao lado de `serviceAccountMinter` |
| `src/integrations/analytics/ga4/ga4-minter.ts` (criar) | `minterFor(authKind, credentials)` — o único lugar que escolhe |
| `src/integrations/analytics/ga4/ga4-admin.ts` (criar) | `listGa4Properties` sobre `accountSummaries` |
| `src/integrations/analytics/index.ts` (modificar) | exporta os novos |
| `src/measurement/read-measurement.ts` (modificar) | `minterFor` + recusa sem property |
| `src/ai/tools/list-source-metrics.ts` (modificar) | `minterFor` + recusa sem property |
| `src/http/api/integrations/verify-integration.ts` (modificar) | `minterFor` |
| `prisma/migrations/20260804150000_integration_property_optional/migration.sql` (criar) | `DROP NOT NULL` em `externalId` |
| `prisma/schema.prisma` (modificar) | `externalId String?` |
| `src/lib/errors.ts` + `src/shared/errors/catalog.ts` + `i18n/*.json` (modificar) | `NO_ANALYTICS_PROPERTY` = `AUR-T0040` |
| `src/http/api/integrations/integrations.schema.ts` (modificar) | `externalId` nulável na resposta |
| `src/http/api/integrations/integrations.repository.ts` (modificar) | `upsertOauth`, `setProperty` |
| `src/http/api/integrations/google/oauth-state.ts` (criar) | assina e verifica o `state` |
| `src/http/api/integrations/google/google-client.ts` (criar) | monta o `OAuth2Client` a partir do env, ou recusa |
| `src/http/api/integrations/google-authorize/*` (criar) | `POST /integrations/google/authorize` |
| `src/http/api/integrations/google-callback/*` (criar) | `GET /integrations/google/callback` — **pública** |
| `src/http/api/integrations/google-properties/*` (criar) | `GET /integrations/google/properties` |
| `src/http/api/integrations/select-property/*` (criar) | `PUT /integrations/google/property` |
| `src/http/api/integrations/integrations.service.ts` (modificar) | `connectOauth`, `selectProperty`, revogação no `remove` |
| `src/http/api/integrations/index.ts` (modificar) | registra as três rotas autenticadas |
| `src/app.ts` (modificar) | registra o callback fora do escopo autenticado |

`google/` guarda o que é do fornecedor de identidade (state, client), separado das pastas de use-case — do mesmo jeito que `verify-integration.ts` não vive dentro de `put-integration/`.

### Frontend

| arquivo | responsabilidade |
|---|---|
| `src/components/integrations/GoogleConnectButton.tsx` (criar) | pede a URL e navega |
| `src/components/integrations/ServiceAccountForm.tsx` (criar) | o formulário de hoje, extraído |
| `src/components/integrations/PropertyPicker.tsx` (criar) | lista, escolhe, confirma |
| `src/components/integrations/Ga4SourceCard.tsx` (criar) | os três estados, banner e confirmação de substituição |
| `src/components/integrations/Ga4ConnectionCard.tsx` (deletar) | dissolvido nos quatro acima |
| `src/pages/IntegrationsPage.tsx` (modificar) | monta o card novo |
| `src/i18n/locales/{en,pt,es}.json` (modificar) | copy dos estados novos |

---

## Task 1: `minterFor` — um segundo cunhador, e um só lugar que escolhe

**Files:**
- Modify: `back/src/config/env.ts`
- Modify: `back/src/integrations/analytics/ga4/ga4-token.ts`
- Create: `back/src/integrations/analytics/ga4/ga4-minter.ts`
- Create: `back/src/integrations/analytics/ga4/ga4-minter.test.ts`
- Modify: `back/src/integrations/analytics/index.ts`
- Modify: `back/src/measurement/read-measurement.ts`
- Modify: `back/src/ai/tools/list-source-metrics.ts`
- Modify: `back/src/http/api/integrations/verify-integration.ts`

**Interfaces:**
- Produces:
  ```ts
  export function oauthMinter(credentialsJson: string, client: { clientId: string; clientSecret: string }): () => Promise<string>;
  export function minterFor(authKind: string, credentialsJson: string): () => Promise<string>;
  ```
  `minterFor` lê o env por dentro (é o que evita três leitores). `CreateProvider` em `read-measurement.ts` passa a receber `authKind`.

- [ ] **Step 1: Escreva o teste que falha**

`back/src/integrations/analytics/ga4/ga4-minter.test.ts`:

```ts
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
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `cd back && pnpm vitest run src/integrations/analytics/ga4/ga4-minter.test.ts`
Expected: FAIL — `Cannot find module './ga4-minter.js'`.

- [ ] **Step 3: Env**

`back/src/config/env.ts` — dentro de `baseEnvSchema`, junto do bloco do Stripe:

```ts
  // OAuth do Google para conectar uma property do GA4. As três opcionais: sem
  // elas, só o caminho de service account existe, e isso é estado legítimo.
  GOOGLE_OAUTH_CLIENT_ID: optionalText,
  GOOGLE_OAUTH_CLIENT_SECRET: optionalText,
  // Explícita, não derivada do host da requisição: o Google exige
  // correspondência exata com o que está registrado no console, e um valor
  // derivado falha como `redirect_uri_mismatch` — o erro mais caro de
  // diagnosticar deste fluxo.
  GOOGLE_OAUTH_REDIRECT_URI: optionalText,
```

E dentro do `superRefine` existente, depois da checagem de `APP_URL`:

```ts
  // Meia configuração de OAuth é um botão que leva a uma tela de erro do
  // Google. As três juntas, ou nenhuma.
  const oauth = {
    GOOGLE_OAUTH_CLIENT_ID: value.GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: value.GOOGLE_OAUTH_CLIENT_SECRET,
    GOOGLE_OAUTH_REDIRECT_URI: value.GOOGLE_OAUTH_REDIRECT_URI,
  } as const;
  const present = Object.entries(oauth).filter(([, v]) => v !== undefined);
  if (present.length > 0 && present.length < 3) {
    for (const [key, v] of Object.entries(oauth)) {
      if (v === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: 'set all three GOOGLE_OAUTH_* variables, or none of them',
        });
      }
    }
  }
```

- [ ] **Step 4: `oauthMinter`**

`back/src/integrations/analytics/ga4/ga4-token.ts` — acrescente o import e a função (mantenha `serviceAccountMinter` e `serviceAccountEmail` como estão):

```ts
import { JWT, OAuth2Client } from 'google-auth-library';
```

```ts
/**
 * Cunha o token a partir de um refresh token do OAuth.
 *
 * A renovação e o cache são da biblioteca, pela mesma razão que
 * `serviceAccountMinter` delega: renovar token é criptografia, e criptografia
 * escrita em casa para economizar dependência custa um incidente.
 *
 * O `redirectUri` não entra: ele só importa na troca do código, não na
 * renovação.
 */
export function oauthMinter(
  credentialsJson: string,
  client: { clientId: string; clientSecret: string },
): () => Promise<string> {
  let oauth: OAuth2Client | null = null;

  return async () => {
    if (!oauth) {
      let parsed: { refresh_token?: unknown };
      try {
        parsed = JSON.parse(credentialsJson) as typeof parsed;
      } catch {
        throw new AnalyticsProviderError('the google credential is not valid JSON');
      }
      if (typeof parsed.refresh_token !== 'string') {
        throw new AnalyticsProviderError('the google credential has no refresh_token');
      }
      oauth = new OAuth2Client({ clientId: client.clientId, clientSecret: client.clientSecret });
      oauth.setCredentials({ refresh_token: parsed.refresh_token });
    }

    const { token } = await oauth.getAccessToken();
    if (!token) throw new AnalyticsProviderError('google did not return an access token');
    return token;
  };
}
```

- [ ] **Step 5: `minterFor`**

`back/src/integrations/analytics/ga4/ga4-minter.ts`:

```ts
import { env } from '../../../config/env.js';
import { AnalyticsProviderError } from '../analytics-provider.js';
import { oauthMinter, serviceAccountMinter } from './ga4-token.js';

/**
 * O único lugar que escolhe o cunhador pelo `authKind`.
 *
 * Existe para que os três chamadores — a leitura da medição, a verificação da
 * credencial e a tool do agente — não repitam a escolha: três cópias de um
 * `if` sobre `authKind` divergem no dia em que entrar o terceiro caminho.
 */
export function minterFor(authKind: string, credentialsJson: string): () => Promise<string> {
  if (authKind === 'SERVICE_ACCOUNT') return serviceAccountMinter(credentialsJson);

  if (authKind === 'OAUTH') {
    const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
    // A credencial existe no banco e o ambiente não sabe renová-la: isso
    // acontece de verdade num deploy que perdeu a variável, e a mensagem tem de
    // dizer qual é o problema em vez de "não foi possível ler".
    if (!clientId || !clientSecret) {
      throw new AnalyticsProviderError('google oauth is not configured in this environment');
    }
    return oauthMinter(credentialsJson, { clientId, clientSecret });
  }

  throw new AnalyticsProviderError(`unsupported credential kind: ${authKind}`);
}
```

`back/src/integrations/analytics/index.ts` — acrescente:

```ts
export { minterFor } from './ga4/ga4-minter.js';
export { oauthMinter } from './ga4/ga4-token.js';
```

- [ ] **Step 6: Migre os três chamadores**

`back/src/measurement/read-measurement.ts` — `CreateProvider` ganha `authKind`, e o default usa `minterFor`:

```ts
export type CreateProvider = (args: {
  propertyId: string;
  credentials: string;
  authKind: string;
}) => AnalyticsProvider;

const defaultCreateProvider: CreateProvider = ({ propertyId, credentials, authKind }) =>
  createGa4Provider({ propertyId, mintToken: minterFor(authKind, credentials) });
```

e a chamada dentro do leitor:

```ts
    const provider = createProvider({
      propertyId: row.externalId,
      credentials: openIntegrationCredential(row),
      authKind: row.authKind,
    });
```

Troque o import de `serviceAccountMinter` por `minterFor`.

`back/src/ai/tools/list-source-metrics.ts` — a dep injetada passa a ser o `minterFor`:

```ts
export function createListSourceMetricsTool(
  deps: { mintToken?: (authKind: string, credentials: string) => () => Promise<string> } = {},
): Tool<Args> {
  const minter = deps.mintToken ?? minterFor;
```

e a construção:

```ts
        const provider = createGa4Provider({
          propertyId: row.externalId,
          mintToken: minter(row.authKind, openIntegrationCredential(row)),
        });
```

`back/src/http/api/integrations/verify-integration.ts` — a verificação continua sendo só de service account (é o único caminho que recebe credencial no corpo; o OAuth se verifica pelo `health()` na escolha da property), mas passa a usar o seletor para não haver duas rotas de escolha:

```ts
    const provider = createGa4Provider({
      propertyId: input.externalId,
      mintToken: minterFor(input.authKind, input.credentials),
    });
```

A guarda de cima (`input.provider !== 'GA4' || input.authKind !== 'SERVICE_ACCOUNT'`) **fica como está**: esta rota só aceita service account.

- [ ] **Step 7: Rode a suíte**

Run: `cd back && pnpm typecheck && pnpm vitest run src/integrations src/measurement src/ai/tools src/http/api/integrations`
Expected: PASS, tsc exit 0. Os testes que injetavam `mintToken` na tool passam a injetar a assinatura de dois argumentos — ajuste os que quebrarem, e **reporte** cada ajuste.

- [ ] **Step 8: Stage e mostre o diff (NÃO comite)**

```bash
cd back && git add src/config/env.ts src/integrations src/measurement src/ai/tools src/http/api/integrations/verify-integration.ts
git status --short && git diff --cached --stat
```

Mensagem sugerida: `refactor(analytics): choose the token minter in one place`

---

## Task 2: A property nulável, e a recusa que a nomeia

**Files:**
- Create: `back/prisma/migrations/20260804150000_integration_property_optional/migration.sql`
- Modify: `back/prisma/schema.prisma` (`model WorkspaceIntegration`)
- Modify: `back/src/shared/errors/catalog.ts`, `src/shared/errors/i18n/{pt-BR,en-US,es-ES}.json`, `src/lib/errors.ts`
- Modify: `back/src/measurement/read-measurement.ts`
- Modify: `back/src/ai/tools/list-source-metrics.ts`
- Modify: `back/src/http/api/integrations/integrations.schema.ts`
- Test: `back/src/measurement/read-measurement.test.ts` (acrescentar)

**Interfaces:**
- Consumes: `minterFor` e o `CreateProvider` com `authKind` (Task 1).
- Produces: `NoAnalyticsPropertyError` (`AUR-T0040`, 400); `externalId: z.string().nullable()` na resposta de integração; `WorkspaceIntegration.externalId` nulável.

- [ ] **Step 1: Escreva os testes que falham**

Em `back/src/measurement/read-measurement.test.ts`, acrescente ao `describe('createMeasurementReader')`:

```ts
  // Conectado e sem property escolhida é um estado real — o intervalo entre
  // autorizar no Google e escolher a property. Devolver "nenhuma fonte
  // conectada" aqui mandaria o fundador conectar o que já está conectado.
  it('recusa com código próprio quando a fonte está conectada sem property', async () => {
    const provider = providerFake();
    const read = createMeasurementReader({
      prisma: prismaFake({ integration: { ...INTEGRATION, externalId: null } }) as never,
      createProvider: provider.factory,
    });

    await expect(read(WORKSPACE_ID, EXPERIMENT_ID, signal())).rejects.toMatchObject({
      code: 'AUR-T0040',
      statusCode: 400,
    });
    expect(provider.readMetric).not.toHaveBeenCalled();
  });

  it('passa o authKind da linha para a fábrica do provider', async () => {
    const provider = providerFake();
    const read = createMeasurementReader({ prisma: prismaFake() as never, createProvider: provider.factory });

    await read(WORKSPACE_ID, EXPERIMENT_ID, signal());

    expect(provider.factory).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: '123456789', authKind: 'SERVICE_ACCOUNT' }),
    );
  });
```

- [ ] **Step 2: Rode e confirme que falham**

Run: `cd back && pnpm vitest run src/measurement`
Expected: FAIL — a primeira estoura ao montar a consulta com property nula (ou devolve `AUR-T0037`), a segunda falha porque `authKind` não é passado se a Task 1 não estiver aplicada.

- [ ] **Step 3: Migração à mão**

`back/prisma/migrations/20260804150000_integration_property_optional/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "WorkspaceIntegration" ALTER COLUMN "externalId" DROP NOT NULL;
```

- [ ] **Step 4: Schema do Prisma**

`back/prisma/schema.prisma`, em `model WorkspaceIntegration`, troque a linha de `externalId`:

```prisma
  /**
   * Property do GA4. Nula entre autorizar no Google e escolher a property —
   * um intervalo real, e representá-lo com string vazia seria um valor-sentinela
   * que todo leitor teria de conhecer.
   */
  externalId   String?
```

- [ ] **Step 5: Aplique e gere o client**

Run: `cd back && pnpm prisma:deploy && pnpm prisma:generate`
Expected: migração aplicada; `pnpm prisma migrate status` diz "Database schema is up to date!". Drift ⇒ pare e reporte.

- [ ] **Step 6: O código de recusa**

`back/src/shared/errors/catalog.ts` — depois de `MEASUREMENT_READ_FAILED`:

```ts
  NO_ANALYTICS_PROPERTY: { code: 'AUR-T0040', status: 400 },
```

`i18n/pt-BR.json`:

```json
  "AUR-T0040": "A fonte de dados está conectada, mas nenhuma property foi escolhida ainda."
```

`i18n/en-US.json`:

```json
  "AUR-T0040": "The data source is connected, but no property has been chosen yet."
```

`i18n/es-ES.json`:

```json
  "AUR-T0040": "La fuente de datos está conectada, pero aún no se eligió ninguna propiedad."
```

`back/src/lib/errors.ts` — no fim:

```ts
/**
 * Conectado, sem property. Distinto de `NoAnalyticsSourceError`: aqui a
 * credencial existe e o que falta é a escolha — e a tela oferece escolher, não
 * conectar.
 */
export class NoAnalyticsPropertyError extends AppError {
  constructor() {
    const def = getErrorDef('NO_ANALYTICS_PROPERTY');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}
```

- [ ] **Step 7: As duas guardas e o schema de resposta**

`back/src/measurement/read-measurement.ts` — depois de `if (!row) throw new NoAnalyticsSourceError();`:

```ts
    // Conectado sem property: nada a ler, e a recusa diz qual é o passo que
    // falta em vez de mandar conectar de novo.
    if (!row.externalId) throw new NoAnalyticsPropertyError();
```

`back/src/ai/tools/list-source-metrics.ts` — depois do `if (!row) return { error: ... }`:

```ts
      // Devolvido, não lançado: o run continua e o agente diz o que falta, em
      // vez de morrer FAILED com o crédito gasto.
      if (!row.externalId) return { error: 'a data source is connected but no property has been chosen yet' };
```

`back/src/http/api/integrations/integrations.schema.ts` — `externalId` passa a nulável:

```ts
  externalId: z.string().nullable(),
```

- [ ] **Step 8: Rode a suíte**

Run: `cd back && pnpm typecheck && pnpm test`
Expected: tsc 0, suíte verde. Baseline: **1039 testes / 116 arquivos**.

- [ ] **Step 9: Stage e mostre o diff (NÃO comite)**

```bash
cd back && git add prisma src/shared/errors src/lib/errors.ts src/measurement src/ai/tools src/http/api/integrations/integrations.schema.ts
git status --short && git diff --cached --stat
```

Mensagem sugerida: `feat(integrations): allow a source connected without a property yet`

---

## Task 3: `state` assinado e `POST /integrations/google/authorize`

**Files:**
- Create: `back/src/http/api/integrations/google/oauth-state.ts`
- Create: `back/src/http/api/integrations/google/oauth-state.test.ts`
- Create: `back/src/http/api/integrations/google/google-client.ts`
- Create: `back/src/http/api/integrations/google-authorize/google-authorize.controller.ts`
- Create: `back/src/http/api/integrations/google-authorize/google-authorize.schema.ts`
- Create: `back/src/http/api/integrations/google-authorize/google-authorize.test.ts`
- Modify: `back/src/http/api/integrations/index.ts`

**Interfaces:**
- Produces:
  ```ts
  // oauth-state.ts
  export type OAuthState = { workspaceId: string; userId: string };
  export type JwtLike = { sign(payload: object, options?: { expiresIn?: string }): string; verify(token: string): unknown };
  export function signOAuthState(jwt: JwtLike, state: OAuthState): string;
  export function verifyOAuthState(jwt: JwtLike, token: string): OAuthState;  // BadRequestError se inválido
  // google-client.ts
  export function googleOAuthClient(): OAuth2Client;      // BadRequestError se o env não estiver configurado
  export function googleOAuthConfigured(): boolean;
  export const GOOGLE_SCOPES: readonly string[];
  // google-authorize.controller.ts
  export const googleAuthorizeRoute: FastifyPluginAsync;
  ```

- [ ] **Step 1: Escreva os testes que falham**

`back/src/http/api/integrations/google/oauth-state.test.ts`:

```ts
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
    const wrong = j.sign({ ...STATE, purpose: 'password-reset' });

    expect(() => verifyOAuthState(j, wrong)).toThrow(/state/i);
  });

  it('recusa um token expirado', async () => {
    const j = await jwt();
    const expired = j.sign({ ...STATE, purpose: 'google-oauth' }, { expiresIn: '-1s' });

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
```

`back/src/http/api/integrations/google-authorize/google-authorize.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../../lib/errors.js';

const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** `env.ts` lê `process.env` no import, então o módulo entra depois do stub. */
async function buildApp(oauth: boolean, role: 'ADMIN' | 'MEMBER' = 'ADMIN') {
  vi.resetModules();
  if (oauth) {
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'client-id');
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'client-secret');
    vi.stubEnv('GOOGLE_OAUTH_REDIRECT_URI', 'http://localhost:3000/integrations/google/callback');
  }
  const { googleAuthorizeRoute } = await import('./google-authorize.controller.js');

  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(fastifyJwt, { secret: 'a-test-secret-long-enough', sign: { expiresIn: '15m' } });
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: WORKSPACE_ID, role };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
    throw error;
  });
  await app.register(googleAuthorizeRoute);
  return app;
}

describe('POST /integrations/google/authorize', () => {
  it('devolve a url de consentimento do Google', async () => {
    const app = await buildApp(true);

    const res = await app.inject({ method: 'POST', url: '/integrations/google/authorize' });

    expect(res.statusCode).toBe(200);
    const url = new URL(res.json().url);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    // Offline + consent é o que garante refresh_token: sem ele a conexão morre
    // em uma hora.
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('pede leitura de analytics e nada de escrita', async () => {
    const app = await buildApp(true);

    const url = new URL((await app.inject({ method: 'POST', url: '/integrations/google/authorize' })).json().url);

    const scope = url.searchParams.get('scope') ?? '';
    expect(scope).toContain('https://www.googleapis.com/auth/analytics.readonly');
    expect(scope).not.toContain('analytics.edit');
    expect(scope).not.toContain('analytics.manage');
  });

  it('o state carrega o workspace do tenant', async () => {
    const app = await buildApp(true);

    const url = new URL((await app.inject({ method: 'POST', url: '/integrations/google/authorize' })).json().url);
    const decoded = app.jwt.verify(url.searchParams.get('state') as string) as Record<string, unknown>;

    expect(decoded).toMatchObject({ workspaceId: WORKSPACE_ID, userId: 'u1', purpose: 'google-oauth' });
  });

  it('recusa quando o OAuth não está configurado no ambiente', async () => {
    const app = await buildApp(false);

    const res = await app.inject({ method: 'POST', url: '/integrations/google/authorize' });

    expect(res.statusCode).toBe(400);
  });

  it('nega para quem não é admin', async () => {
    const app = await buildApp(true, 'MEMBER');

    expect((await app.inject({ method: 'POST', url: '/integrations/google/authorize' })).statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Rode e confirme que falham**

Run: `cd back && pnpm vitest run src/http/api/integrations/google src/http/api/integrations/google-authorize`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: `oauth-state.ts`**

```ts
import { BadRequestError } from '../../../../lib/errors.js';

/** O que o callback precisa saber, e nada mais. */
export type OAuthState = { workspaceId: string; userId: string };

/** O `app.jwt` do Fastify, reduzido ao que este módulo usa. */
export type JwtLike = {
  sign(payload: object, options?: { expiresIn?: string }): string;
  verify(token: string): unknown;
};

/**
 * Dez minutos: é uma ida ao Google e volta.
 *
 * Sem uso único de propósito. Um replay dentro da janela reconecta o mesmo
 * workspace à mesma conta Google — o resultado que o humano pediu. Uma tabela
 * de nonce compraria pouco e custaria uma tabela.
 */
const TTL = '10m';

const PURPOSE = 'google-oauth';

/**
 * O `state` é o que autoriza o callback, que é público. Duas travas, e as duas
 * são sobre confusão entre famílias de token:
 *
 * - `purpose` impede um access token do app de servir como state;
 * - a **ausência de `sub`** impede um state de servir como Bearer, porque
 *   `authenticate`/`resolveTenant` leem `sub`. Os dois compartilham o segredo e
 *   não compartilham forma.
 */
export function signOAuthState(jwt: JwtLike, state: OAuthState): string {
  return jwt.sign({ workspaceId: state.workspaceId, userId: state.userId, purpose: PURPOSE }, { expiresIn: TTL });
}

export function verifyOAuthState(jwt: JwtLike, token: string): OAuthState {
  // `verify` estoura por conta própria em assinatura errada e em expiração.
  const decoded = jwt.verify(token) as Record<string, unknown>;

  if (decoded.purpose !== PURPOSE) throw new BadRequestError('not a google oauth state token');
  if (typeof decoded.workspaceId !== 'string' || typeof decoded.userId !== 'string') {
    throw new BadRequestError('not a google oauth state token');
  }

  return { workspaceId: decoded.workspaceId, userId: decoded.userId };
}
```

- [ ] **Step 4: `google-client.ts`**

```ts
import { OAuth2Client } from 'google-auth-library';
import { env } from '../../../../config/env.js';
import { BadRequestError } from '../../../../lib/errors.js';

/**
 * Somente leitura de analytics, mais os dois escopos de identidade.
 *
 * `openid`/`email` não são sensíveis e não mexem na verificação do app; existem
 * para `verifyIdToken` devolver o e-mail da conta, que é o que o fundador
 * reconhece na tela.
 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',
  'openid',
  'email',
] as const;

export function googleOAuthConfigured(): boolean {
  return Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REDIRECT_URI);
}

/**
 * O client, ou uma recusa nomeada. Ambiente sem OAuth é estado legítimo — a
 * service account continua funcionando —, então isto é 400 com mensagem e não
 * falha de boot.
 */
export function googleOAuthClient(): OAuth2Client {
  if (!googleOAuthConfigured()) {
    throw new BadRequestError('Connecting with Google is not enabled in this environment');
  }
  return new OAuth2Client({
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
  });
}
```

- [ ] **Step 5: A rota**

`google-authorize/google-authorize.schema.ts`:

```ts
import { z } from 'zod';

export const googleAuthorizeResponse = z.object({
  /** A url de consentimento. O frontend navega para ela; ele não a monta. */
  url: z.string().url(),
});
```

`google-authorize/google-authorize.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { assertAdmin } from '../../../../lib/tenant.js';
import { GOOGLE_SCOPES, googleOAuthClient } from '../google/google-client.js';
import { signOAuthState } from '../google/oauth-state.js';
import { googleAuthorizeResponse } from './google-authorize.schema.js';

/**
 * Devolve a url em vez de redirecionar.
 *
 * A navegação do browser não carrega o header `Authorization`, então o frontend
 * busca a url com o token e só então navega. Um GET que redirecionasse teria de
 * aceitar o token na query string, e token em url vai para histórico e log de
 * proxy.
 */
export const googleAuthorizeRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/integrations/google/authorize',
    {
      schema: {
        tags: ['integrations'],
        operationId: 'authorizeGoogle',
        response: { 200: googleAuthorizeResponse },
      },
    },
    async (req, reply) => {
      assertAdmin(req.tenant);

      const url = googleOAuthClient().generateAuthUrl({
        // `offline` + `consent` é o que garante um refresh_token. Sem ele a
        // conexão morre em uma hora e volta como "medição falhou" depois.
        access_type: 'offline',
        prompt: 'consent',
        scope: [...GOOGLE_SCOPES],
        state: signOAuthState(app.jwt, {
          // O workspace sai do tenant e viaja assinado: é ele que o callback,
          // que é público, vai usar para saber onde gravar.
          workspaceId: req.tenant.workspaceId,
          userId: req.tenant.userId,
        }),
      });

      return reply.send({ url });
    },
  );
};
```

`back/src/http/api/integrations/index.ts` — acrescente o registro:

```ts
  await app.register(googleAuthorizeRoute);
```

- [ ] **Step 6: Rode os testes**

Run: `cd back && pnpm vitest run src/http/api/integrations && pnpm typecheck`
Expected: PASS, tsc 0.

- [ ] **Step 7: Stage e mostre o diff (NÃO comite)**

```bash
cd back && git add src/http/api/integrations && git status --short && git diff --cached --stat
```

Mensagem sugerida: `feat(integrations): start a Google authorization`

---

## Task 4: O callback público

**Files:**
- Create: `back/src/http/api/integrations/google-callback/google-callback.controller.ts`
- Create: `back/src/http/api/integrations/google-callback/google-callback.schema.ts`
- Create: `back/src/http/api/integrations/google-callback/google-callback.test.ts`
- Modify: `back/src/http/api/integrations/integrations.repository.ts`
- Modify: `back/src/http/api/integrations/integrations.service.ts`
- Modify: `back/src/app.ts`

**Interfaces:**
- Consumes: `verifyOAuthState`, `googleOAuthClient`, `GOOGLE_SCOPES` (Task 3); `seal` de `src/billing/crypto.js`.
- Produces:
  ```ts
  // integrations.repository.ts
  upsertOauth(input: { workspaceId: string; provider: string; ciphertext: Buffer; iv: Buffer; authTag: Buffer; accountLabel: string; createdBy: string; connectedAt: Date }): Promise<…>
  // google-callback.controller.ts
  export type CodeExchange = (code: string) => Promise<{ refreshToken: string | null; email: string | null }>;
  export type GoogleCallbackOptions = { exchange?: CodeExchange };
  export const googleCallbackRoute: FastifyPluginAsync<GoogleCallbackOptions>;
  ```

- [ ] **Step 1: Escreva o teste que falha**

`back/src/http/api/integrations/google-callback/google-callback.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { AppError } from '../../../../lib/errors.js';
import { open } from '../../../../billing/crypto.js';
import { signOAuthState } from '../google/oauth-state.js';
import { googleCallbackRoute } from './google-callback.controller.js';

const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_WORKSPACE = '33333333-3333-3333-3333-333333333333';

const upsert = vi.fn();

function prismaFake() {
  return {
    workspaceIntegration: {
      upsert: upsert.mockImplementation(async (args: unknown) => args),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

/**
 * A troca do código entra por opção de plugin. Sem isto o teste chamaria o
 * endpoint de token do Google de dentro da suíte.
 */
const acceptingExchange = (email: string | null = 'founder@acme.com') =>
  vi.fn().mockResolvedValue({ refreshToken: 'rt-secret', email });

async function buildApp(exchange: ReturnType<typeof acceptingExchange>) {
  const app = Fastify();
  app.decorate('prisma', prismaFake() as never);
  await app.register(fastifyJwt, { secret: 'a-test-secret-long-enough', sign: { expiresIn: '15m' } });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
    throw error;
  });
  await app.register(googleCallbackRoute, { exchange });
  return app;
}

const url = (params: Record<string, string>) =>
  `/integrations/google/callback?${new URLSearchParams(params).toString()}`;

describe('GET /integrations/google/callback', () => {
  it('sela o refresh token e grava a integração sem property', async () => {
    const app = await buildApp(acceptingExchange());
    const state = signOAuthState(app.jwt, { workspaceId: WORKSPACE_ID, userId: 'u1' });

    const res = await app.inject({ method: 'GET', url: url({ code: 'auth-code', state }) });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('/app/settings/integrations?google=connected');

    const args = upsert.mock.calls[0]![0] as { create: Record<string, unknown> };
    expect(args.create).toMatchObject({
      workspaceId: WORKSPACE_ID,
      provider: 'GA4',
      authKind: 'OAUTH',
      // Autorizado, nenhuma property escolhida: o estado que a Task 2 tornou
      // representável.
      externalId: null,
      status: 'UNVERIFIED',
      accountLabel: 'founder@acme.com',
      createdBy: 'u1',
    });
    // Selado, e recuperável só pela chave de cifra.
    expect(
      open({
        ciphertext: Buffer.from(args.create.ciphertext as Uint8Array),
        iv: Buffer.from(args.create.iv as Uint8Array),
        authTag: Buffer.from(args.create.authTag as Uint8Array),
      }),
    ).toBe(JSON.stringify({ refresh_token: 'rt-secret' }));
  });

  it('nada do Google entra na url de volta', async () => {
    const app = await buildApp(acceptingExchange());
    const state = signOAuthState(app.jwt, { workspaceId: WORKSPACE_ID, userId: 'u1' });

    const res = await app.inject({ method: 'GET', url: url({ code: 'auth-code', state }) });

    const location = res.headers.location as string;
    expect(location).not.toContain('auth-code');
    expect(location).not.toContain('rt-secret');
  });

  // O workspace sai do state assinado. Este teste existe para fixar isso: se
  // alguém trocar por query string, ele quebra.
  it('grava no workspace do state, e em nenhum outro', async () => {
    const app = await buildApp(acceptingExchange());
    const state = signOAuthState(app.jwt, { workspaceId: OTHER_WORKSPACE, userId: 'u9' });

    await app.inject({ method: 'GET', url: url({ code: 'auth-code', state, workspaceId: WORKSPACE_ID }) });

    const args = upsert.mock.calls[0]![0] as { create: Record<string, unknown>; where: unknown };
    expect(args.create.workspaceId).toBe(OTHER_WORKSPACE);
    expect(args.where).toEqual({ workspaceId_provider: { workspaceId: OTHER_WORKSPACE, provider: 'GA4' } });
  });

  it('recusa um state ausente ou inválido, sem gravar e sem redirecionar', async () => {
    const app = await buildApp(acceptingExchange());

    const missing = await app.inject({ method: 'GET', url: url({ code: 'auth-code' }) });
    const garbage = await app.inject({ method: 'GET', url: url({ code: 'auth-code', state: 'not-a-jwt' }) });

    expect(missing.statusCode).toBe(400);
    expect(garbage.statusCode).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('devolve o fundador com erro quando ele recusa o consentimento', async () => {
    const exchange = acceptingExchange();
    const app = await buildApp(exchange);
    const state = signOAuthState(app.jwt, { workspaceId: WORKSPACE_ID, userId: 'u1' });

    const res = await app.inject({ method: 'GET', url: url({ error: 'access_denied', state }) });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('google=error');
    expect(res.headers.location).toContain('reason=access_denied');
    expect(exchange).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  // Vocabulário fechado: o Google devolve o que quiser em `error`, e isso vira
  // query string na nossa própria aplicação.
  it('sanitiza um reason que não é do vocabulário', async () => {
    const app = await buildApp(acceptingExchange());
    const state = signOAuthState(app.jwt, { workspaceId: WORKSPACE_ID, userId: 'u1' });

    const res = await app.inject({
      method: 'GET',
      url: url({ error: '<script>alert(1)</script>', state }),
    });

    expect(res.headers.location).toContain('reason=unknown');
    expect(res.headers.location).not.toContain('script');
  });

  it('não grava quando o Google não devolve refresh token', async () => {
    const app = await buildApp(vi.fn().mockResolvedValue({ refreshToken: null, email: 'founder@acme.com' }));
    const state = signOAuthState(app.jwt, { workspaceId: WORKSPACE_ID, userId: 'u1' });

    const res = await app.inject({ method: 'GET', url: url({ code: 'auth-code', state }) });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('reason=no_refresh_token');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('conecta com rótulo genérico quando o id_token não traz e-mail', async () => {
    const app = await buildApp(acceptingExchange(null));
    const state = signOAuthState(app.jwt, { workspaceId: WORKSPACE_ID, userId: 'u1' });

    await app.inject({ method: 'GET', url: url({ code: 'auth-code', state }) });

    const args = upsert.mock.calls[0]![0] as { create: Record<string, unknown> };
    expect(args.create.accountLabel).toBe('google account');
  });

  it('devolve o fundador com erro quando a troca do código falha', async () => {
    const app = await buildApp(vi.fn().mockRejectedValue(new Error('invalid_grant')));
    const state = signOAuthState(app.jwt, { workspaceId: WORKSPACE_ID, userId: 'u1' });

    const res = await app.inject({ method: 'GET', url: url({ code: 'auth-code', state }) });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('google=error');
    expect(upsert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `cd back && pnpm vitest run src/http/api/integrations/google-callback`
Expected: FAIL — `Cannot find module './google-callback.controller.js'`.

- [ ] **Step 3: Repositório**

`back/src/http/api/integrations/integrations.repository.ts` — acrescente ao objeto devolvido:

```ts
    /**
     * A gravação do OAuth: credencial selada, nenhuma property, `UNVERIFIED`.
     *
     * Separada de `upsert` de propósito. `upsert` grava `status: 'OK'` porque a
     * credencial dela **já** passou por um `health()` na verificação; aqui não
     * houve verificação nenhuma ainda, e marcar OK seria afirmar o que não se
     * sabe.
     */
    upsertOauth(input: {
      workspaceId: string;
      provider: string;
      ciphertext: Buffer;
      iv: Buffer;
      authTag: Buffer;
      accountLabel: string;
      createdBy: string;
      connectedAt: Date;
    }) {
      const { workspaceId, provider, createdBy, connectedAt, ciphertext, iv, authTag, accountLabel } = input;
      const connected = {
        authKind: 'OAUTH',
        accountLabel,
        // Uint8Array, não Buffer: é o que a coluna `Bytes` do Prisma aceita.
        ciphertext: new Uint8Array(ciphertext),
        iv: new Uint8Array(iv),
        authTag: new Uint8Array(authTag),
        // Autorizado, sem property escolhida. Trocar de caminho zera a property
        // do caminho anterior: a credencial nova pode não ver aquela property.
        externalId: null,
        status: 'UNVERIFIED',
        lastError: null,
        lastCheckedAt: connectedAt,
      };
      return prisma.workspaceIntegration.upsert({
        where: { workspaceId_provider: { workspaceId, provider } },
        create: { workspaceId, provider, createdBy, ...connected },
        update: connected,
        select: PUBLIC_SELECT,
      });
    },
```

- [ ] **Step 4: Controller**

`google-callback/google-callback.schema.ts`:

```ts
import { z } from 'zod';

/**
 * Tudo opcional: é o Google que preenche, e um callback malformado tem de
 * chegar ao handler para virar recusa nomeada em vez de erro de validação sem
 * contexto.
 */
export const googleCallbackQuery = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});
```

`google-callback/google-callback.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { env } from '../../../../config/env.js';
import { seal } from '../../../../billing/crypto.js';
import { BadRequestError } from '../../../../lib/errors.js';
import { createIntegrationsRepository } from '../integrations.repository.js';
import { googleOAuthClient } from '../google/google-client.js';
import { verifyOAuthState } from '../google/oauth-state.js';
import { googleCallbackQuery } from './google-callback.schema.js';

/** O que a troca do código devolve, reduzido ao que gravamos. */
export type CodeExchange = (code: string) => Promise<{ refreshToken: string | null; email: string | null }>;

export type GoogleCallbackOptions = { exchange?: CodeExchange };

const PROVIDER = 'GA4';
const RETURN_PATH = '/app/settings/integrations';

/** Vocabulário fechado: o `error` do Google vira query string da nossa app. */
const REASON = /^[a-z_]{1,40}$/;

function backTo(params: Record<string, string>): string {
  const url = new URL(RETURN_PATH, env.APP_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

/**
 * A troca real do código pelo token, e o e-mail da conta.
 *
 * `verifyIdToken` em vez de decodificar o id_token à mão: verificar assinatura
 * de JWT de terceiro é exatamente o tipo de coisa que a biblioteca faz certo.
 */
const exchangeWithGoogle: CodeExchange = async (code) => {
  const client = googleOAuthClient();
  const { tokens } = await client.getToken(code);

  let email: string | null = null;
  if (tokens.id_token) {
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: env.GOOGLE_OAUTH_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    email = typeof payload?.email === 'string' ? payload.email : null;
  }

  return { refreshToken: tokens.refresh_token ?? null, email };
};

/**
 * Público de propósito: o Google redireciona o browser, sem header nenhum.
 * Registrado direto no `app.ts`, fora do escopo autenticado, como
 * `stripeWebhookRoute`.
 *
 * Quem autoriza aqui é o `state` assinado — é dele, e de nada da query string,
 * que sai o workspace onde gravar.
 */
export const googleCallbackRoute: FastifyPluginAsync<GoogleCallbackOptions> = async (app, opts) => {
  const exchange = opts.exchange ?? exchangeWithGoogle;

  app.withTypeProvider<ZodTypeProvider>().get(
    '/integrations/google/callback',
    {
      schema: {
        tags: ['integrations'],
        operationId: 'googleCallback',
        querystring: googleCallbackQuery,
        // Sem `response`: esta rota redireciona, não devolve corpo. É a única
        // do sistema sem envelope, e a razão é o browser do outro lado.
        hide: true,
      },
    },
    async (req, reply) => {
      const { code, state, error } = req.query;

      // O state primeiro, sempre: sem ele não se sabe nem de quem é este
      // callback, e um 400 aqui não vira redirect porque não há para onde
      // voltar com confiança.
      if (!state) throw new BadRequestError('missing state');
      const { workspaceId, userId } = verifyOAuthState(app.jwt, state);

      // O fundador recusou o consentimento, ou o Google recusou por outra
      // razão. Nada foi autorizado, então nada é gravado.
      if (error) {
        return reply.redirect(backTo({ google: 'error', reason: REASON.test(error) ? error : 'unknown' }));
      }
      if (!code) return reply.redirect(backTo({ google: 'error', reason: 'missing_code' }));

      let exchanged: Awaited<ReturnType<CodeExchange>>;
      try {
        exchanged = await exchange(code);
      } catch {
        // A mensagem do Google não vai para a url. O fundador vê "não deu"; o
        // detalhe fica no log do servidor.
        req.log.warn('google oauth code exchange failed');
        return reply.redirect(backTo({ google: 'error', reason: 'exchange_failed' }));
      }

      // Sem refresh token, a conexão morreria em uma hora e voltaria como
      // "medição falhou" dias depois. Melhor não existir.
      if (!exchanged.refreshToken) {
        return reply.redirect(backTo({ google: 'error', reason: 'no_refresh_token' }));
      }

      await createIntegrationsRepository(app.prisma).upsertOauth({
        workspaceId,
        provider: PROVIDER,
        accountLabel: exchanged.email ?? 'google account',
        createdBy: userId,
        connectedAt: new Date(),
        ...seal(JSON.stringify({ refresh_token: exchanged.refreshToken })),
      });

      return reply.redirect(backTo({ google: 'connected' }));
    },
  );
};
```

- [ ] **Step 5: Registre no `app.ts`**

`back/src/app.ts` — import, e o registro **fora** dos escopos autenticados, junto do webhook do Stripe:

```ts
import { googleCallbackRoute } from './http/api/integrations/google-callback/google-callback.controller.js';
```

```ts
  // Pública: o Google redireciona o browser sem header. Sem OAuth configurado a
  // rota não existe — melhor não existir do que existir sem cliente para trocar
  // o código, mesma regra do webhook do Stripe acima.
  if (env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REDIRECT_URI) {
    await app.register(googleCallbackRoute);
  }
```

- [ ] **Step 6: Rode os testes**

Run: `cd back && pnpm vitest run src/http/api/integrations && pnpm typecheck`
Expected: PASS, tsc 0.

- [ ] **Step 7: Stage e mostre o diff (NÃO comite)**

```bash
cd back && git add src/http/api/integrations src/app.ts && git status --short && git diff --cached --stat
```

Mensagem sugerida: `feat(integrations): finish a Google authorization and seal the refresh token`

---

## Task 5: Listar properties, escolher uma, e revogar ao desconectar

**Files:**
- Create: `back/src/integrations/analytics/ga4/ga4-admin.ts`
- Create: `back/src/integrations/analytics/ga4/ga4-admin.test.ts`
- Create: `back/src/http/api/integrations/google-properties/google-properties.controller.ts`
- Create: `back/src/http/api/integrations/google-properties/google-properties.schema.ts`
- Create: `back/src/http/api/integrations/select-property/select-property.controller.ts`
- Create: `back/src/http/api/integrations/select-property/select-property.schema.ts`
- Create: `back/src/http/api/integrations/google-property.test.ts`
- Modify: `back/src/integrations/analytics/index.ts`
- Modify: `back/src/http/api/integrations/integrations.repository.ts`
- Modify: `back/src/http/api/integrations/integrations.service.ts`
- Modify: `back/src/http/api/integrations/index.ts`
- Modify: `back/src/http/api/integrations/integrations.test.ts` (revogação no DELETE)

**Interfaces:**
- Consumes: `minterFor` (Task 1), `openIntegrationCredential`, `createGa4Provider`.
- Produces:
  ```ts
  // ga4-admin.ts
  export type SourceProperty = { propertyId: string; displayName: string; accountName: string };
  export function listGa4Properties(mintToken: () => Promise<string>, signal: AbortSignal): Promise<{ properties: SourceProperty[]; truncated: boolean }>;
  // integrations.repository.ts
  setProperty(id: string, externalId: string, verified: { status: string; lastError: string | null; checkedAt: Date }): Promise<…>
  // controllers
  export type GooglePropertiesOptions = { list?: typeof listGa4Properties };
  export const googlePropertiesRoute: FastifyPluginAsync<GooglePropertiesOptions>;
  export type PropertyCheck = (row: { authKind: string; ciphertext: Uint8Array; iv: Uint8Array; authTag: Uint8Array }, propertyId: string, signal: AbortSignal) => Promise<{ ok: true } | { ok: false; reason: string }>;
  export type SelectPropertyOptions = { check?: PropertyCheck };
  export const selectPropertyRoute: FastifyPluginAsync<SelectPropertyOptions>;
  // remove-integration.controller.ts
  export type RemoveIntegrationOptions = { revoke?: (credentialsJson: string) => Promise<void> };
  export const removeIntegrationRoute: FastifyPluginAsync<RemoveIntegrationOptions>;
  // google/google-client.ts
  export function revokeGoogleCredential(credentialsJson: string): Promise<void>;
  ```

- [ ] **Step 1: Escreva o teste do cliente Admin**

`back/src/integrations/analytics/ga4/ga4-admin.test.ts`:

```ts
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
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `cd back && pnpm vitest run src/integrations/analytics/ga4/ga4-admin.test.ts`
Expected: FAIL — `Cannot find module './ga4-admin.js'`.

- [ ] **Step 3: O cliente Admin**

`back/src/integrations/analytics/ga4/ga4-admin.ts`:

```ts
import { z } from 'zod';
import { AnalyticsProviderError } from '../analytics-provider.js';

const BASE = 'https://analyticsadmin.googleapis.com/v1beta';

/** O teto da API. Uma página; mais que isso é declarado, não escondido. */
const PAGE_SIZE = 200;

/** O que a tela mostra: nome que o humano reconhece, e a conta que o situa. */
export type SourceProperty = { propertyId: string; displayName: string; accountName: string };

const summariesSchema = z.object({
  accountSummaries: z
    .array(
      z.object({
        displayName: z.string().optional(),
        propertySummaries: z
          .array(z.object({ property: z.string(), displayName: z.string().optional() }))
          .optional(),
      }),
    )
    .default([]),
  nextPageToken: z.string().optional(),
});

/**
 * As properties que aquela credencial enxerga.
 *
 * É o motivo de o OAuth existir: com service account o fundador tem de caçar o
 * id numérico no console; aqui ele reconhece "Site institucional".
 */
export async function listGa4Properties(
  mintToken: () => Promise<string>,
  signal: AbortSignal,
): Promise<{ properties: SourceProperty[]; truncated: boolean }> {
  const token = await mintToken();
  const response = await fetch(`${BASE}/accountSummaries?pageSize=${PAGE_SIZE}`, {
    headers: { authorization: `Bearer ${token}` },
    signal,
  });

  if (!response.ok) {
    const detail = await response
      .json()
      .then((json: unknown) => {
        const parsed = z.object({ error: z.object({ message: z.string() }) }).safeParse(json);
        return parsed.success ? parsed.data.error.message : null;
      })
      .catch(() => null);
    throw new AnalyticsProviderError(detail ?? `ga4 admin request failed with status ${response.status}`);
  }

  const parsed = summariesSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new AnalyticsProviderError('ga4 returned unreadable account summaries');

  const properties = parsed.data.accountSummaries.flatMap((account) =>
    (account.propertySummaries ?? []).map((property) => ({
      // `properties/123` → `123`: o resto do sistema guarda o id, e monta o
      // caminho onde precisa dele.
      propertyId: property.property.replace(/^properties\//, ''),
      displayName: property.displayName ?? property.property,
      accountName: account.displayName ?? '',
    })),
  );

  return { properties, truncated: parsed.data.nextPageToken !== undefined };
}
```

`back/src/integrations/analytics/index.ts` — acrescente:

```ts
export { listGa4Properties, type SourceProperty } from './ga4/ga4-admin.js';
```

- [ ] **Step 4: Escreva o teste das duas rotas**

`back/src/http/api/integrations/google-property.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../lib/errors.js';
import { seal } from '../../../billing/crypto.js';
import { googlePropertiesRoute } from './google-properties/google-properties.controller.js';
import { selectPropertyRoute } from './select-property/select-property.controller.js';

const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';
const SEALED = seal(JSON.stringify({ refresh_token: 'rt' }));

const ROW = {
  id: 'int-1',
  workspaceId: WORKSPACE_ID,
  provider: 'GA4',
  authKind: 'OAUTH',
  ciphertext: new Uint8Array(SEALED.ciphertext),
  iv: new Uint8Array(SEALED.iv),
  authTag: new Uint8Array(SEALED.authTag),
  externalId: null,
  accountLabel: 'founder@acme.com',
  status: 'UNVERIFIED',
  lastCheckedAt: new Date('2026-08-04T00:00:00Z'),
  lastError: null,
};

const update = vi.fn();

/** `'integration' in over`, não `??`: o caso "sem integração" passa `null`. */
function prismaFake(over: { integration?: unknown } = {}) {
  return {
    workspaceIntegration: {
      findFirst: vi.fn().mockResolvedValue('integration' in over ? over.integration : ROW),
      update: update.mockResolvedValue({ ...ROW, externalId: '123456789', status: 'OK' }),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

const PROPERTIES = {
  properties: [{ propertyId: '123456789', displayName: 'Site institucional', accountName: 'Acme Inc' }],
  truncated: false,
};

async function buildApp(
  prisma: unknown,
  deps: {
    list?: ReturnType<typeof vi.fn>;
    check?: ReturnType<typeof vi.fn>;
    role?: 'ADMIN' | 'MEMBER';
  } = {},
) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prisma as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: WORKSPACE_ID, role: deps.role ?? 'ADMIN' };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
    throw error;
  });
  // Listagem e verificação entram por opção: sem isso a suíte chamaria o
  // Google.
  await app.register(googlePropertiesRoute, { list: deps.list ?? vi.fn().mockResolvedValue(PROPERTIES) });
  await app.register(selectPropertyRoute, { check: deps.check ?? vi.fn().mockResolvedValue({ ok: true }) });
  return app;
}

describe('GET /integrations/google/properties', () => {
  it('lista as properties que a credencial enxerga', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({ method: 'GET', url: '/integrations/google/properties' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(PROPERTIES);
  });

  it('não devolve segredo nenhum', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({ method: 'GET', url: '/integrations/google/properties' });

    expect(res.body).not.toContain('refresh_token');
    expect(res.body).not.toContain('ciphertext');
  });

  it('lê a integração do workspace do tenant', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    await app.inject({ method: 'GET', url: '/integrations/google/properties' });

    expect(prisma.workspaceIntegration.findFirst).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, provider: 'GA4' },
    });
  });

  it('404 quando não há fonte conectada', async () => {
    const app = await buildApp(prismaFake({ integration: null }));

    expect((await app.inject({ method: 'GET', url: '/integrations/google/properties' })).statusCode).toBe(404);
  });

  it('propaga a mensagem da fonte quando a listagem falha', async () => {
    const app = await buildApp(prismaFake(), {
      list: vi.fn().mockRejectedValue(new Error('Caller does not have permission.')),
    });

    const res = await app.inject({ method: 'GET', url: '/integrations/google/properties' });

    expect(res.statusCode).toBe(400);
  });

  it('nega para quem não é admin', async () => {
    const app = await buildApp(prismaFake(), { role: 'MEMBER' });

    expect((await app.inject({ method: 'GET', url: '/integrations/google/properties' })).statusCode).toBe(403);
  });
});

describe('PUT /integrations/google/property', () => {
  const payload = { propertyId: '123456789' };

  it('grava a property e o resultado da verificação', async () => {
    const check = vi.fn().mockResolvedValue({ ok: true });
    const app = await buildApp(prismaFake(), { check });

    const res = await app.inject({ method: 'PUT', url: '/integrations/google/property', payload });

    expect(res.statusCode).toBe(200);
    expect(check).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'int-1' },
        data: expect.objectContaining({ externalId: '123456789', status: 'OK', lastError: null }),
      }),
    );
  });

  // A validação da property é o próprio health(): se a conta não vê aquela
  // property, a leitura falha, e é essa a verdade que interessa.
  it('grava FAILED com a mensagem da fonte quando a property não responde', async () => {
    const app = await buildApp(prismaFake(), {
      check: vi.fn().mockResolvedValue({ ok: false, reason: 'Caller does not have permission.' }),
    });

    const res = await app.inject({ method: 'PUT', url: '/integrations/google/property', payload });

    expect(res.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', lastError: 'Caller does not have permission.' }),
      }),
    );
  });

  it('recusa um propertyId que não é numérico', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({ method: 'PUT', url: '/integrations/google/property', payload: { propertyId: 'G-ABC123' } });

    expect(res.statusCode).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('404 quando não há fonte conectada', async () => {
    const app = await buildApp(prismaFake({ integration: null }));

    expect((await app.inject({ method: 'PUT', url: '/integrations/google/property', payload })).statusCode).toBe(404);
  });

  it('nega para quem não é admin', async () => {
    const app = await buildApp(prismaFake(), { role: 'MEMBER' });

    expect((await app.inject({ method: 'PUT', url: '/integrations/google/property', payload })).statusCode).toBe(403);
  });
});
```

- [ ] **Step 5: Rode e confirme que falha**

Run: `cd back && pnpm vitest run src/http/api/integrations/google-property.test.ts`
Expected: FAIL — controllers inexistentes.

- [ ] **Step 6: Repositório e serviço**

`integrations.repository.ts` — acrescente:

```ts
    /**
     * A property escolhida e o resultado da verificação, numa escrita só: um
     * update em duas etapas deixaria a linha com property nova e status antigo.
     */
    setProperty(
      id: string,
      externalId: string,
      verified: { status: string; lastError: string | null; checkedAt: Date },
    ) {
      return prisma.workspaceIntegration.update({
        where: { id },
        data: {
          externalId,
          status: verified.status,
          lastError: verified.lastError,
          lastCheckedAt: verified.checkedAt,
        },
        select: PUBLIC_SELECT,
      });
    },
```

`integrations.service.ts` — a revogação no `remove`:

```ts
    /**
     * Desconectar de verdade.
     *
     * Guardar um refresh token vivo depois de o fundador ter desconectado é
     * ficar com uma credencial que prometemos parar de ter. A revogação é
     * melhor-esforço: o que ele pediu foi parar de usar, e uma falha do Google
     * não pode impedir a remoção — ele ainda tem a tela dele para revogar do
     * outro lado.
     */
    async remove(workspaceId: string, provider: string) {
      const row = await deps.repo.find(workspaceId, provider);
      if (row?.authKind === 'OAUTH' && deps.revoke) {
        try {
          await deps.revoke(openIntegrationCredential(row));
        } catch {
          // Silêncio deliberado: a remoção segue.
        }
      }
      await deps.repo.remove(workspaceId, provider);
    },
```

e a dep nova na fábrica:

```ts
export function createIntegrationsService(deps: {
  repo: IntegrationsRepository;
  verify: VerifyIntegration;
  /** Revoga o refresh token no Google. Ausente ⇒ nada a revogar. */
  revoke?: (credentialsJson: string) => Promise<void>;
}) {
```

O revogador real, em `google/google-client.ts`:

```ts
/**
 * Revoga o refresh token no Google. Sem OAuth configurado não há o que revogar
 * — e chamar isto assim é um no-op, não um erro: o caminho de remoção não pode
 * quebrar por causa de configuração ausente.
 */
export async function revokeGoogleCredential(credentialsJson: string): Promise<void> {
  if (!googleOAuthConfigured()) return;
  const parsed = JSON.parse(credentialsJson) as { refresh_token?: unknown };
  if (typeof parsed.refresh_token !== 'string') return;
  await googleOAuthClient().revokeToken(parsed.refresh_token);
}
```

E `remove-integration/remove-integration.controller.ts` ganha a opção de plugin — mesmo padrão do `verify` em `put-integration`, e pela mesma razão: sem ela um teste do DELETE chamaria o endpoint de revogação do Google. Acrescente ao arquivo existente (mantendo o schema e o corpo do handler que já estão lá):

```ts
import { revokeGoogleCredential } from '../google/google-client.js';

/**
 * O revogador entra por opção, não por decorator ambiente: um teste que
 * esquecesse de substituí-lo sairia falando com o Google de dentro da suíte.
 */
export type RemoveIntegrationOptions = { revoke?: (credentialsJson: string) => Promise<void> };

export const removeIntegrationRoute: FastifyPluginAsync<RemoveIntegrationOptions> = async (app, opts) => {
  const revoke = opts.revoke ?? revokeGoogleCredential;
  // ... o resto do arquivo como está, com o serviço construído assim:
  //   createIntegrationsService({ repo: createIntegrationsRepository(app.prisma), verify: verifyIntegration, revoke })
};
```

E `integrations/index.ts` repassa: `await app.register(removeIntegrationRoute, { revoke: opts.revoke });`, com `RemoveIntegrationOptions` entrando na união de `IntegrationsRoutesOptions`.

- [ ] **Step 7: Os dois controllers**

`google-properties/google-properties.schema.ts`:

```ts
import { z } from 'zod';

export const googlePropertiesResponse = z.object({
  properties: z.array(
    z.object({
      propertyId: z.string(),
      displayName: z.string(),
      accountName: z.string(),
    }),
  ),
  /**
   * A fonte tinha mais do que uma página. Booleano e não contagem: a API não
   * informa total, e dizer "faltaram N" seria um número sem origem.
   */
  truncated: z.boolean(),
});
```

`google-properties/google-properties.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { listGa4Properties, minterFor } from '../../../../integrations/analytics/index.js';
import { BadRequestError, NotFoundError } from '../../../../lib/errors.js';
import { assertAdmin } from '../../../../lib/tenant.js';
import { createIntegrationsRepository } from '../integrations.repository.js';
import { openIntegrationCredential } from '../integrations.service.js';
import { googlePropertiesResponse } from './google-properties.schema.js';

export type GooglePropertiesOptions = { list?: typeof listGa4Properties };

/** Uma listagem de metadata, não um relatório. */
const TIMEOUT_MS = 10_000;

const PROVIDER = 'GA4';

/**
 * Funciona para os dois `authKind`: uma service account com acesso concedido
 * também enxerga account summaries. Não é exclusiva do OAuth porque não precisa
 * ser, e assim "trocar de property" existe nos dois caminhos.
 */
export const googlePropertiesRoute: FastifyPluginAsync<GooglePropertiesOptions> = async (app, opts) => {
  const list = opts.list ?? listGa4Properties;

  app.withTypeProvider<ZodTypeProvider>().get(
    '/integrations/google/properties',
    {
      schema: {
        tags: ['integrations'],
        operationId: 'listGoogleProperties',
        response: { 200: googlePropertiesResponse },
      },
    },
    async (req, reply) => {
      assertAdmin(req.tenant);

      const row = await createIntegrationsRepository(app.prisma).find(req.tenant.workspaceId, PROVIDER);
      if (!row) throw new NotFoundError('No data source is connected');

      try {
        const result = await list(
          minterFor(row.authKind, openIntegrationCredential(row)),
          AbortSignal.timeout(TIMEOUT_MS),
        );
        return reply.send(result);
      } catch (error) {
        // A mensagem da própria fonte: "Caller does not have permission" diz ao
        // fundador o que fazer.
        throw new BadRequestError(error instanceof Error ? error.message : 'could not list the properties');
      }
    },
  );
};
```

`select-property/select-property.schema.ts`:

```ts
import { z } from 'zod';

export const selectPropertyBody = z.object({
  /**
   * O id numérico da property. `G-XXXXXXX` é o id de métrica do site e não
   * serve para consultar a API — recusar aqui é recusar antes de uma ida ao
   * Google que falharia sem explicar o porquê.
   */
  propertyId: z.string().regex(/^\d{1,20}$/, 'propertyId must be the numeric property id'),
});
```

`select-property/select-property.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createGa4Provider, minterFor } from '../../../../integrations/analytics/index.js';
import { NotFoundError } from '../../../../lib/errors.js';
import { assertAdmin } from '../../../../lib/tenant.js';
import { createIntegrationsRepository } from '../integrations.repository.js';
import { integrationResponse } from '../integrations.schema.js';
import { openIntegrationCredential } from '../integrations.service.js';
import { selectPropertyBody } from './select-property.schema.js';

/** Uma credencial guardada + uma property = dá para ler? */
export type PropertyCheck = (
  row: { authKind: string; ciphertext: Uint8Array; iv: Uint8Array; authTag: Uint8Array },
  propertyId: string,
  signal: AbortSignal,
) => Promise<{ ok: true } | { ok: false; reason: string }>;

export type SelectPropertyOptions = { check?: PropertyCheck };

const TIMEOUT_MS = 10_000;
const PROVIDER = 'GA4';

/**
 * A verificação real, e ela **é** a validação da property: se a conta não vê
 * aquela property, o `health()` falha. Uma segunda ida à lista de properties
 * custaria outra chamada para responder pior.
 */
const checkWithSource: PropertyCheck = async (row, propertyId, signal) => {
  try {
    const provider = createGa4Provider({
      propertyId,
      mintToken: minterFor(row.authKind, openIntegrationCredential(row)),
    });
    await provider.health(signal);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'unknown error' };
  }
};

export const selectPropertyRoute: FastifyPluginAsync<SelectPropertyOptions> = async (app, opts) => {
  const check = opts.check ?? checkWithSource;

  app.withTypeProvider<ZodTypeProvider>().put(
    '/integrations/google/property',
    {
      schema: {
        tags: ['integrations'],
        operationId: 'selectGoogleProperty',
        body: selectPropertyBody,
        response: { 200: integrationResponse },
      },
    },
    async (req, reply) => {
      assertAdmin(req.tenant);

      const repo = createIntegrationsRepository(app.prisma);
      const row = await repo.find(req.tenant.workspaceId, PROVIDER);
      if (!row) throw new NotFoundError('No data source is connected');

      const verified = await check(row, req.body.propertyId, AbortSignal.timeout(TIMEOUT_MS));

      // Grava nos dois casos, e é de propósito: uma property que não responde
      // ainda é a escolha do fundador, e `FAILED` com a mensagem da fonte é o
      // que permite a tela explicar. Perder a escolha o obrigaria a escolher de
      // novo sem saber o que deu errado.
      const integration = await repo.setProperty(row.id, req.body.propertyId, {
        status: verified.ok ? 'OK' : 'FAILED',
        lastError: verified.ok ? null : verified.reason,
        checkedAt: new Date(),
      });

      return reply.send({ integration });
    },
  );
};
```

`back/src/http/api/integrations/index.ts` — registre as duas:

```ts
  await app.register(googlePropertiesRoute, { list: opts.list });
  await app.register(selectPropertyRoute, { check: opts.check });
```

e o tipo de opção do plugin passa a ser a união das três opções que ele repassa:

```ts
export type IntegrationsRoutesOptions = PutIntegrationOptions & GooglePropertiesOptions & SelectPropertyOptions;

export const integrationsRoutes: FastifyPluginAsync<IntegrationsRoutesOptions> = async (app, opts) => {
```

- [ ] **Step 8: A revogação no teste do DELETE**

Em `back/src/http/api/integrations/integrations.test.ts`, acrescente ao `describe('DELETE /integrations')`. O `prismaFake` do arquivo devolve `ROW` (service account) em `findFirst`; para o caso OAuth passe uma linha própria — se `prismaFake` não aceitar override, acrescente o parâmetro seguindo o padrão `'key' in over`:

```ts
  it('revoga a credencial no Google antes de apagar uma conexão OAuth', async () => {
    const revoke = vi.fn().mockResolvedValue(undefined);
    const prisma = prismaFake();
    prisma.workspaceIntegration.findFirst.mockResolvedValue({ ...ROW, authKind: 'OAUTH' });
    const app = await buildApp(prisma, 'ADMIN', acceptingVerify(), revoke);

    const res = await app.inject({ method: 'DELETE', url: '/integrations?provider=GA4' });

    expect(res.statusCode).toBe(204);
    expect(revoke).toHaveBeenCalled();
    expect(prisma.workspaceIntegration.deleteMany).toHaveBeenCalled();
  });

  // O que ele pediu foi parar de usar. Uma falha do Google não pode segurar a
  // remoção.
  it('apaga mesmo quando a revogação falha', async () => {
    const revoke = vi.fn().mockRejectedValue(new Error('invalid_token'));
    const prisma = prismaFake();
    prisma.workspaceIntegration.findFirst.mockResolvedValue({ ...ROW, authKind: 'OAUTH' });
    const app = await buildApp(prisma, 'ADMIN', acceptingVerify(), revoke);

    expect((await app.inject({ method: 'DELETE', url: '/integrations?provider=GA4' })).statusCode).toBe(204);
    expect(prisma.workspaceIntegration.deleteMany).toHaveBeenCalled();
  });

  it('não tenta revogar uma service account', async () => {
    const revoke = vi.fn();
    const app = await buildApp(prismaFake(), 'ADMIN', acceptingVerify(), revoke);

    await app.inject({ method: 'DELETE', url: '/integrations?provider=GA4' });

    expect(revoke).not.toHaveBeenCalled();
  });
```

Para isso, `buildApp` daquele arquivo ganha um quarto parâmetro `revoke` que ele repassa como opção do plugin, e `removeIntegrationRoute` passa a aceitar `{ revoke?: (credentialsJson: string) => Promise<void> }` — o mesmo padrão de opção de plugin do `verify`, e pela mesma razão: sem isso um teste chamaria o Google.

- [ ] **Step 9: Rode a suíte inteira e regenere o contrato**

Run: `cd back && pnpm typecheck && pnpm test && pnpm openapi:dump`
Expected: tsc 0, suíte verde, `../web/api.json` com `authorizeGoogle`, `listGoogleProperties` e `selectGoogleProperty`. O `googleCallback` fica **fora** do contrato (`hide: true`): ele não é chamado pelo frontend, é o Google que o chama.

- [ ] **Step 10: Stage e mostre o diff (NÃO comite)**

```bash
cd back && git add src/integrations src/http/api/integrations && git status --short && git diff --cached --stat
cd ../web && git add api.json && git status --short
```

Mensagens sugeridas: `feat(integrations): choose a property, and revoke on disconnect` (back), `chore(web): regenerate the API contract` (web).

---

## Task 6: Os três componentes-folha

**Files:**
- Create: `web/src/components/integrations/GoogleConnectButton.tsx` + `.test.tsx`
- Create: `web/src/components/integrations/ServiceAccountForm.tsx` + `.test.tsx`
- Create: `web/src/components/integrations/PropertyPicker.tsx` + `.test.tsx`
- Modify: `web/src/i18n/locales/{en,pt,es}.json`

**Interfaces:**
- Consumes: hooks gerados `useAuthorizeGoogle`, `useListGoogleProperties`, `useSelectGoogleProperty`, `usePutIntegration`.
- Produces:
  ```tsx
  <GoogleConnectButton onError={(message: string) => void} label={string} />
  <ServiceAccountForm onConnected={() => void} />
  <PropertyPicker current={string | null} onSelected={() => void} />
  ```

- [ ] **Step 1: Gere os hooks e leia as assinaturas reais**

Run: `cd web && pnpm api:generate`

Depois **leia** os arquivos gerados antes de escrever qualquer chamada:

```bash
ls src/api/generated/hooks/integrationsHooks/
```

Confirme o nome exato de cada hook, a forma do argumento de mutação (`{ data }` vs `{}` vs `{ params }`) e o nome da função de query key. Use o que o gerador produziu, não o que este plano supõe. `useAuthorizeGoogle` é um POST **sem corpo** — verifique se o hook gerado exige `{ data: {} }` ou nada.

- [ ] **Step 2: i18n nas três línguas**

Em `web/src/i18n/locales/en.json`, dentro de `pages.integrations`, acrescente:

```json
      "google": {
        "connect": "Connect with Google",
        "connecting": "Opening Google…",
        "failed": "Could not start the Google connection.",
        "notConfigured": "Connecting with Google is not enabled on this server. Use a service account key below.",
        "advanced": "Use a service account key instead",
        "advancedHint": "For when you would rather not link a Google account — it takes a few steps in the Google Cloud console.",
        "connectedBanner": "Google connected. Now choose which property AUREA should read.",
        "errorBanner": "The Google connection did not finish.",
        "reason": {
          "access_denied": "You declined the authorization.",
          "no_refresh_token": "Google did not return a lasting authorization. Try again and accept the consent screen.",
          "exchange_failed": "Google refused the authorization code.",
          "missing_code": "Google sent no authorization code.",
          "unknown": "Google reported an error it did not explain."
        }
      },
      "picker": {
        "title": "Which property should AUREA read?",
        "help": "A property is one Google Analytics dataset — usually one site or one app. AUREA reads a metric from it; it never writes.",
        "helpTitle": "Property",
        "empty": "This Google account sees no Analytics property. Check that it has at least read access to one.",
        "truncated": "Showing the first 200 properties this account can see. If yours is missing, use a service account key for it instead.",
        "select": "Use this property",
        "selecting": "Checking…",
        "failed": "Could not read the properties of this account.",
        "change": "Change property",
        "cancel": "Cancel",
        "noneChosen": "Connected, but no property chosen yet — AUREA cannot read a number until you choose one."
      },
      "replace": {
        "title": "Replace the current connection?",
        "body": "This workspace already has a data source connected. Connecting another one replaces it, and the property choice starts over.",
        "confirm": "Replace it",
        "cancel": "Keep the current one"
      },
```

`pt.json`:

```json
      "google": {
        "connect": "Conectar com Google",
        "connecting": "Abrindo o Google…",
        "failed": "Não foi possível iniciar a conexão com o Google.",
        "notConfigured": "A conexão com o Google não está habilitada neste servidor. Use uma chave de service account abaixo.",
        "advanced": "Usar uma chave de service account",
        "advancedHint": "Para quando você preferir não vincular uma conta Google — leva alguns passos no console do Google Cloud.",
        "connectedBanner": "Google conectado. Agora escolha qual property a AUREA deve ler.",
        "errorBanner": "A conexão com o Google não foi concluída.",
        "reason": {
          "access_denied": "Você recusou a autorização.",
          "no_refresh_token": "O Google não devolveu uma autorização durável. Tente de novo e aceite a tela de consentimento.",
          "exchange_failed": "O Google recusou o código de autorização.",
          "missing_code": "O Google não enviou código de autorização.",
          "unknown": "O Google informou um erro sem explicar qual."
        }
      },
      "picker": {
        "title": "Qual property a AUREA deve ler?",
        "help": "Uma property é um conjunto de dados do Google Analytics — normalmente um site ou um app. A AUREA lê uma métrica dela; nunca escreve.",
        "helpTitle": "Property",
        "empty": "Esta conta Google não vê nenhuma property do Analytics. Confira se ela tem acesso de leitura a alguma.",
        "truncated": "Mostrando as primeiras 200 properties que esta conta vê. Se a sua não está aqui, use uma chave de service account para ela.",
        "select": "Usar esta property",
        "selecting": "Verificando…",
        "failed": "Não foi possível ler as properties desta conta.",
        "change": "Trocar property",
        "cancel": "Cancelar",
        "noneChosen": "Conectada, mas nenhuma property escolhida — a AUREA não consegue ler número nenhum até você escolher."
      },
      "replace": {
        "title": "Substituir a conexão atual?",
        "body": "Este workspace já tem uma fonte de dados conectada. Conectar outra substitui a atual, e a escolha da property começa de novo.",
        "confirm": "Substituir",
        "cancel": "Manter a atual"
      },
```

`es.json`:

```json
      "google": {
        "connect": "Conectar con Google",
        "connecting": "Abriendo Google…",
        "failed": "No se pudo iniciar la conexión con Google.",
        "notConfigured": "La conexión con Google no está habilitada en este servidor. Usa una clave de cuenta de servicio abajo.",
        "advanced": "Usar una clave de cuenta de servicio",
        "advancedHint": "Para cuando prefieras no vincular una cuenta de Google — lleva algunos pasos en la consola de Google Cloud.",
        "connectedBanner": "Google conectado. Ahora elige qué propiedad debe leer AUREA.",
        "errorBanner": "La conexión con Google no se completó.",
        "reason": {
          "access_denied": "Rechazaste la autorización.",
          "no_refresh_token": "Google no devolvió una autorización duradera. Inténtalo de nuevo y acepta la pantalla de consentimiento.",
          "exchange_failed": "Google rechazó el código de autorización.",
          "missing_code": "Google no envió código de autorización.",
          "unknown": "Google informó un error sin explicar cuál."
        }
      },
      "picker": {
        "title": "¿Qué propiedad debe leer AUREA?",
        "help": "Una propiedad es un conjunto de datos de Google Analytics — normalmente un sitio o una app. AUREA lee una métrica de ella; nunca escribe.",
        "helpTitle": "Propiedad",
        "empty": "Esta cuenta de Google no ve ninguna propiedad de Analytics. Comprueba que tenga acceso de lectura a alguna.",
        "truncated": "Mostrando las primeras 200 propiedades que ve esta cuenta. Si falta la tuya, usa una clave de cuenta de servicio para ella.",
        "select": "Usar esta propiedad",
        "selecting": "Verificando…",
        "failed": "No se pudieron leer las propiedades de esta cuenta.",
        "change": "Cambiar propiedad",
        "cancel": "Cancelar",
        "noneChosen": "Conectada, pero sin propiedad elegida — AUREA no puede leer ningún número hasta que elijas una."
      },
      "replace": {
        "title": "¿Reemplazar la conexión actual?",
        "body": "Este espacio de trabajo ya tiene una fuente de datos conectada. Conectar otra la reemplaza, y la elección de propiedad empieza de nuevo.",
        "confirm": "Reemplazar",
        "cancel": "Mantener la actual"
      },
```

- [ ] **Step 3: Escreva os três testes que falham**

`web/src/components/integrations/GoogleConnectButton.test.tsx`:

```tsx
import { describe, expect, it, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/render';
import { stubFetch } from '@/test/stub-fetch';
import { GoogleConnectButton } from './GoogleConnectButton';

const CONSENT = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=y';

afterEach(() => vi.unstubAllGlobals());

describe('GoogleConnectButton', () => {
  it('navega para a url que o servidor devolveu', async () => {
    stubFetch({ '/integrations/google/authorize': { body: { url: CONSENT } } });
    // A navegação é stubada: nenhum teste sai do jsdom.
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign, href: 'http://localhost/' });

    renderWithProviders(<GoogleConnectButton label={i18n.t('pages.integrations.google.connect')} />);

    await userEvent.click(screen.getByRole('button', { name: i18n.t('pages.integrations.google.connect') }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith(CONSENT));
  });

  // O servidor recusa quando o ambiente não tem OAuth. A tela diz isso e aponta
  // o outro caminho, em vez de um botão que só falha.
  it('mostra a mensagem do servidor quando o OAuth não está habilitado', async () => {
    stubFetch({
      '/integrations/google/authorize': {
        status: 400,
        body: { error: { code: 'AUR-T0001', message: 'Connecting with Google is not enabled in this environment' } },
      },
    });
    const onError = vi.fn();

    renderWithProviders(
      <GoogleConnectButton label={i18n.t('pages.integrations.google.connect')} onError={onError} />,
    );

    await userEvent.click(screen.getByRole('button', { name: i18n.t('pages.integrations.google.connect') }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringMatching(/not enabled/i)));
  });
});
```

`web/src/components/integrations/PropertyPicker.test.tsx`:

```tsx
import { describe, expect, it, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/render';
import { stubFetch, type StubFetchCall } from '@/test/stub-fetch';
import { PropertyPicker } from './PropertyPicker';

const PROPERTIES = {
  properties: [
    { propertyId: '123456789', displayName: 'Site institucional', accountName: 'Acme Inc' },
    { propertyId: '987654321', displayName: 'App', accountName: 'Acme Inc' },
  ],
  truncated: false,
};

afterEach(() => vi.unstubAllGlobals());

describe('PropertyPicker', () => {
  it('mostra nome da property e da conta, não o id', async () => {
    stubFetch({ '/integrations/google/properties': { body: PROPERTIES } });

    renderWithProviders(<PropertyPicker current={null} />);

    expect(await screen.findByText('Site institucional')).toBeTruthy();
    expect(screen.getAllByText('Acme Inc').length).toBeGreaterThan(0);
  });

  it('manda o propertyId escolhido', async () => {
    const calls: StubFetchCall[] = [];
    stubFetch(
      {
        '/integrations/google/properties': { body: PROPERTIES },
        '/integrations/google/property': { body: { integration: { provider: 'GA4', externalId: '987654321' } } },
      },
      calls,
    );

    renderWithProviders(<PropertyPicker current={null} />);

    await userEvent.click(await screen.findByRole('radio', { name: /App/ }));
    await userEvent.click(screen.getByRole('button', { name: i18n.t('pages.integrations.picker.select') }));

    await waitFor(() => {
      const put = calls.find((call) => call.method === 'PUT');
      expect(put?.body).toEqual({ propertyId: '987654321' });
    });
  });

  it('avisa quando a conta não vê property nenhuma', async () => {
    stubFetch({ '/integrations/google/properties': { body: { properties: [], truncated: false } } });

    renderWithProviders(<PropertyPicker current={null} />);

    expect(await screen.findByText(i18n.t('pages.integrations.picker.empty'))).toBeTruthy();
  });

  // Truncar em silêncio faria uma property ausente parecer inexistente.
  it('declara o corte quando a fonte tinha mais de uma página', async () => {
    stubFetch({ '/integrations/google/properties': { body: { ...PROPERTIES, truncated: true } } });

    renderWithProviders(<PropertyPicker current={null} />);

    expect(await screen.findByText(i18n.t('pages.integrations.picker.truncated'))).toBeTruthy();
  });

  it('mostra a mensagem da fonte quando a listagem falha', async () => {
    stubFetch({
      '/integrations/google/properties': {
        status: 400,
        body: { error: { code: 'AUR-T0001', message: 'Caller does not have permission.' } },
      },
    });

    renderWithProviders(<PropertyPicker current={null} />);

    expect(await screen.findByText(/Caller does not have permission/)).toBeTruthy();
  });

  it('marca a property atual quando já existe uma', async () => {
    stubFetch({ '/integrations/google/properties': { body: PROPERTIES } });

    renderWithProviders(<PropertyPicker current="987654321" />);

    const chosen = (await screen.findByRole('radio', { name: /App/ })) as HTMLInputElement;
    expect(chosen.checked).toBe(true);
  });
});
```

`web/src/components/integrations/ServiceAccountForm.test.tsx` — mova para cá os casos do `Ga4ConnectionCard.test.tsx` que são sobre o formulário (envio da property + credencial, recusa da fonte, e o segredo nunca em tela), adaptando o import e o nome do componente. **Não** apague `Ga4ConnectionCard.test.tsx` nesta task: ele morre com o componente, na Task 7.

- [ ] **Step 4: Rode e confirme que falham**

Run: `cd web && pnpm vitest run src/components/integrations`
Expected: FAIL — três imports não resolvem.

- [ ] **Step 5: `GoogleConnectButton`**

```tsx
import { useTranslation } from 'react-i18next';
import { useAuthorizeGoogle } from '@/api/generated/hooks/integrationsHooks/useAuthorizeGoogle';
import { apiErrorMessage } from '@/lib/api-errors';
import { Button } from '@/components/ui/button';

/**
 * Pede a url de consentimento e navega.
 *
 * A url é montada pelo servidor, não aqui: ela carrega o `state` assinado, e um
 * frontend que montasse a url seria um frontend decidindo em qual workspace
 * gravar.
 */
export function GoogleConnectButton({
  label,
  onError,
  onBeforeStart,
}: {
  label: string;
  onError?: (message: string) => void;
  /** Devolve false para abortar — é onde a confirmação de substituição entra. */
  onBeforeStart?: () => boolean;
}) {
  const { t } = useTranslation();

  const authorize = useAuthorizeGoogle({
    mutation: {
      onSuccess: (data) => window.location.assign(data.url),
      onError: (error) => onError?.(apiErrorMessage(error, t('pages.integrations.google.failed'))),
    },
  });

  return (
    <Button
      size="sm"
      disabled={authorize.isPending}
      onClick={() => {
        if (onBeforeStart && !onBeforeStart()) return;
        authorize.mutate({} as never);
      }}
    >
      {authorize.isPending ? t('pages.integrations.google.connecting') : label}
    </Button>
  );
}
```

Ajuste `authorize.mutate({} as never)` para a forma que o hook gerado exige (Step 1). Se ele aceita zero argumentos, chame `authorize.mutate()` e apague o cast.

- [ ] **Step 6: `ServiceAccountForm`**

`web/src/components/integrations/ServiceAccountForm.tsx` — o ramo `!connected` do `Ga4ConnectionCard.tsx` de hoje (linhas 111-147), agora com dono próprio:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePutIntegration } from '@/api/generated/hooks/integrationsHooks/usePutIntegration';
import { apiErrorMessage } from '@/lib/api-errors';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/form/TextField';
import { TextAreaField } from '@/components/form/TextAreaField';

const PROVIDER = 'GA4';

/**
 * O caminho de service account: uma chave JSON e um id de property.
 *
 * Continua existindo, e recolhido atrás de um disclosure: é o piso que funciona
 * sem depender de nenhuma verificação de app do Google, e é caro para o humano
 * — nove passos em três consoles. Piso, não porta de entrada.
 *
 * A credencial só viaja para cima. Ela nunca volta em resposta nenhuma (o
 * servidor a exclui por `select`, não por confiança), e o campo é limpo assim
 * que a gravação passa: um textarea que continua com a chave é o segredo em
 * tela por tempo indefinido.
 */
export function ServiceAccountForm({
  onConnected,
  onError,
}: {
  onConnected?: () => void;
  onError?: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [propertyId, setPropertyId] = useState('');
  const [credentials, setCredentials] = useState('');

  const connect = usePutIntegration({
    mutation: {
      onSuccess: () => {
        setCredentials('');
        setPropertyId('');
        onConnected?.();
      },
      onError: (error) => onError?.(apiErrorMessage(error, t('pages.integrations.connectFailed'))),
    },
  });

  return (
    <div className="space-y-4">
      <TextField
        htmlFor="ga4-property"
        label={t('pages.integrations.propertyLabel')}
        helpTitle={t('pages.integrations.propertyHelpTitle')}
        help={t('pages.integrations.propertyHelp')}
        value={propertyId}
        onChange={setPropertyId}
      />
      <TextAreaField
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
  );
}
```

O erro sobe pelo `onError` em vez de virar estado local: quem mostra mensagem nesta tela é o card, e dois lugares mostrando erro deixariam o fundador com duas mensagens sobre o mesmo problema.

- [ ] **Step 7: `PropertyPicker`**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useListGoogleProperties } from '@/api/generated/hooks/integrationsHooks/useListGoogleProperties';
import { useSelectGoogleProperty } from '@/api/generated/hooks/integrationsHooks/useSelectGoogleProperty';
import { listIntegrationsQueryKey } from '@/api/generated/hooks/integrationsHooks/useListIntegrations';
import { apiErrorMessage } from '@/lib/api-errors';
import { Help } from '@/components/Help';
import { SectionLoading } from '@/components/SectionState';
import { Button } from '@/components/ui/button';

/**
 * Escolher a property por nome.
 *
 * É o motivo de o OAuth existir: o fundador reconhece "Site institucional"; ele
 * não reconhece `123456789`.
 */
export function PropertyPicker({
  current,
  onSelected,
  onCancel,
}: {
  current: string | null;
  onSelected?: () => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState<string | null>(current);
  const [error, setError] = useState<string | null>(null);

  const properties = useListGoogleProperties({ query: { retry: false } });

  const select = useSelectGoogleProperty({
    mutation: {
      onMutate: () => setError(null),
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: listIntegrationsQueryKey() });
        onSelected?.();
      },
      onError: (err) => setError(apiErrorMessage(err, t('pages.integrations.picker.failed'))),
    },
  });

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">
        {t('pages.integrations.picker.title')}
        <Help title={t('pages.integrations.picker.helpTitle')}>{t('pages.integrations.picker.help')}</Help>
      </p>

      {properties.isLoading && <SectionLoading />}

      {properties.isError && (
        <p className="text-sm text-destructive">
          {apiErrorMessage(properties.error, t('pages.integrations.picker.failed'))}
        </p>
      )}

      {properties.data && properties.data.properties.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('pages.integrations.picker.empty')}</p>
      )}

      {properties.data && properties.data.properties.length > 0 && (
        <>
          <ul className="space-y-2">
            {properties.data.properties.map((property) => (
              <li key={property.propertyId}>
                <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-muted/50">
                  <input
                    type="radio"
                    name="ga4-property"
                    className="mt-1"
                    value={property.propertyId}
                    checked={chosen === property.propertyId}
                    onChange={() => setChosen(property.propertyId)}
                  />
                  <span>
                    <span className="block text-sm font-medium">{property.displayName}</span>
                    <span className="block text-xs text-muted-foreground">{property.accountName}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          {/* O corte declarado: uma property ausente da lista não é uma
              property inexistente. */}
          {properties.data.truncated && (
            <p className="text-xs text-muted-foreground">{t('pages.integrations.picker.truncated')}</p>
          )}
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={chosen === null || select.isPending}
          onClick={() => chosen && select.mutate({ data: { propertyId: chosen } })}
        >
          {select.isPending ? t('pages.integrations.picker.selecting') : t('pages.integrations.picker.select')}
        </Button>
        {onCancel && (
          <Button size="sm" variant="outline" onClick={onCancel}>
            {t('pages.integrations.picker.cancel')}
          </Button>
        )}
      </div>
    </div>
  );
}
```

O `<input type="radio">` cru é deliberado: `components/ui/` não tem primitivo de radio, e a lista precisa de rótulo acessível por `getByRole('radio', { name })`. Se um `RadioField` existir em `components/form/`, use-o.

- [ ] **Step 8: Rode os testes**

Run: `cd web && pnpm vitest run src/components/integrations src/i18n && pnpm typecheck`
Expected: PASS, tsc 0.

- [ ] **Step 9: Stage e mostre o diff (NÃO comite)**

```bash
cd web && git add src/components/integrations src/i18n src/api/generated && git status --short && git diff --cached --stat
```

Mensagem sugerida: `feat(web): the three pieces of connecting a data source`

---

## Task 7: `Ga4SourceCard` — os três estados, o banner e a substituição

**Files:**
- Create: `web/src/components/integrations/Ga4SourceCard.tsx` + `.test.tsx`
- Delete: `web/src/components/integrations/Ga4ConnectionCard.tsx` + `.test.tsx`
- Modify: `web/src/pages/IntegrationsPage.tsx`

**Interfaces:**
- Consumes: `GoogleConnectButton`, `ServiceAccountForm`, `PropertyPicker` (Task 6); `useListIntegrations`, `useRemoveIntegration`.

- [ ] **Step 1: Escreva o teste que falha**

`web/src/components/integrations/Ga4SourceCard.test.tsx`:

```tsx
import { describe, expect, it, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/render';
import { stubFetch, type StubFetchCall } from '@/test/stub-fetch';
import { Ga4SourceCard } from './Ga4SourceCard';

const BASE = {
  id: 'int-1',
  provider: 'GA4',
  authKind: 'OAUTH',
  accountLabel: 'founder@acme.com',
  status: 'OK',
  lastCheckedAt: '2026-08-04T00:00:00.000Z',
  lastError: null,
  createdAt: '2026-08-04T00:00:00.000Z',
};

const WITH_PROPERTY = { ...BASE, externalId: '123456789' };
const WITHOUT_PROPERTY = { ...BASE, externalId: null, status: 'UNVERIFIED' };

const PROPERTIES = {
  properties: [{ propertyId: '123456789', displayName: 'Site institucional', accountName: 'Acme Inc' }],
  truncated: false,
};

afterEach(() => vi.unstubAllGlobals());

describe('Ga4SourceCard', () => {
  it('nada conectado: oferece o Google em destaque e a service account como avançado', async () => {
    stubFetch({ '/integrations': { body: { integrations: [] } } });

    renderWithProviders(<Ga4SourceCard />);

    expect(
      await screen.findByRole('button', { name: i18n.t('pages.integrations.google.connect') }),
    ).toBeTruthy();
    // O formulário técnico existe, e recolhido: pedir JSON de service account a
    // um fundador é pedir que ele vá ao Google Cloud Console.
    expect(screen.getByText(i18n.t('pages.integrations.google.advanced'))).toBeTruthy();
    expect(
      screen.queryByLabelText(new RegExp(i18n.t('pages.integrations.credentialsLabel').replace(/[()]/g, '\\$&'), 'i')),
    ).toBeNull();
  });

  it('conectado sem property: mostra o picker e diz que não dá para medir ainda', async () => {
    stubFetch({
      '/integrations': { body: { integrations: [WITHOUT_PROPERTY] } },
      '/integrations/google/properties': { body: PROPERTIES },
    });

    renderWithProviders(<Ga4SourceCard />);

    expect(await screen.findByText(i18n.t('pages.integrations.picker.noneChosen'))).toBeTruthy();
    expect(await screen.findByText('Site institucional')).toBeTruthy();
  });

  it('conectado com property: mostra conta, property e status, e nunca o segredo', async () => {
    stubFetch({ '/integrations': { body: { integrations: [WITH_PROPERTY] } } });

    const { container } = renderWithProviders(<Ga4SourceCard />);

    expect(await screen.findByText('founder@acme.com')).toBeTruthy();
    expect(screen.getByText('123456789')).toBeTruthy();
    expect(screen.getByText(i18n.t('pages.integrations.status.OK'))).toBeTruthy();
    expect(container.textContent).not.toContain('refresh_token');
    expect(container.textContent).not.toContain('private_key');
  });

  it('trocar property reabre o picker', async () => {
    stubFetch({
      '/integrations': { body: { integrations: [WITH_PROPERTY] } },
      '/integrations/google/properties': { body: PROPERTIES },
    });

    renderWithProviders(<Ga4SourceCard />);

    await userEvent.click(await screen.findByRole('button', { name: i18n.t('pages.integrations.picker.change') }));

    expect(await screen.findByText(i18n.t('pages.integrations.picker.title'))).toBeTruthy();
  });

  // Substituir é destrutivo, e o @@unique garante que é substituição e não
  // adição. Essa é a informação que falta na tela.
  it('pede confirmação antes de substituir uma conexão existente', async () => {
    const calls: StubFetchCall[] = [];
    stubFetch(
      {
        '/integrations': { body: { integrations: [WITH_PROPERTY] } },
        '/integrations/google/authorize': { body: { url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' } },
      },
      calls,
    );

    renderWithProviders(<Ga4SourceCard />);

    await userEvent.click(await screen.findByRole('button', { name: i18n.t('pages.integrations.google.connect') }));

    expect(await screen.findByText(i18n.t('pages.integrations.replace.body'))).toBeTruthy();
    // Nada foi pedido ao servidor até o humano confirmar.
    expect(calls.every((call) => call.path !== '/integrations/google/authorize')).toBe(true);
  });

  it('desconecta', async () => {
    const calls: StubFetchCall[] = [];
    stubFetch(
      {
        '/integrations': [
          { body: { integrations: [WITH_PROPERTY] } },
          { status: 204, body: {} },
          { body: { integrations: [] } },
        ],
      },
      calls,
    );

    renderWithProviders(<Ga4SourceCard />);

    await userEvent.click(await screen.findByRole('button', { name: i18n.t('pages.integrations.disconnect') }));

    await waitFor(() => expect(calls.some((call) => call.method === 'DELETE')).toBe(true));
  });
});
```

O banner de retorno depende de query string, e `renderWithProviders` monta um `MemoryRouter` sem rota inicial configurável. Teste-o com a busca real do jsdom:

```tsx
  it('mostra o banner de retorno do Google e limpa o parâmetro', async () => {
    stubFetch({
      '/integrations': { body: { integrations: [WITHOUT_PROPERTY] } },
      '/integrations/google/properties': { body: PROPERTIES },
    });
    const replaceState = vi.spyOn(window.history, 'replaceState');
    window.history.replaceState({}, '', '/app/settings/integrations?google=connected');

    renderWithProviders(<Ga4SourceCard />);

    expect(await screen.findByText(i18n.t('pages.integrations.google.connectedBanner'))).toBeTruthy();
    // Limpo depois: um F5 não ressuscita a mensagem.
    await waitFor(() => expect(replaceState).toHaveBeenCalled());
    expect(window.location.search).not.toContain('google=connected');
  });

  it('traduz o motivo do erro que o Google devolveu', async () => {
    stubFetch({ '/integrations': { body: { integrations: [] } } });
    window.history.replaceState({}, '', '/app/settings/integrations?google=error&reason=access_denied');

    renderWithProviders(<Ga4SourceCard />);

    expect(await screen.findByText(i18n.t('pages.integrations.google.reason.access_denied'))).toBeTruthy();
  });
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `cd web && pnpm vitest run src/components/integrations/Ga4SourceCard.test.tsx`
Expected: FAIL — `Failed to resolve import "./Ga4SourceCard"`.

- [ ] **Step 3: O card**

`web/src/components/integrations/Ga4SourceCard.tsx` — a estrutura, com os três ramos:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListIntegrations,
  listIntegrationsQueryKey,
} from '@/api/generated/hooks/integrationsHooks/useListIntegrations';
import { useRemoveIntegration } from '@/api/generated/hooks/integrationsHooks/useRemoveIntegration';
import { apiErrorMessage } from '@/lib/api-errors';
import { Help } from '@/components/Help';
import { SectionLoading, SectionLoadError } from '@/components/SectionState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { GoogleConnectButton } from './GoogleConnectButton';
import { PropertyPicker } from './PropertyPicker';
import { ServiceAccountForm } from './ServiceAccountForm';

const PROVIDER = 'GA4';

/** O vocabulário fechado que o callback emite. Qualquer outro vira `unknown`. */
const REASONS = ['access_denied', 'no_refresh_token', 'exchange_failed', 'missing_code'] as const;

function readReturn(): { status: 'connected' | 'error'; reason: string } | null {
  const params = new URLSearchParams(window.location.search);
  const google = params.get('google');
  if (google !== 'connected' && google !== 'error') return null;
  const raw = params.get('reason') ?? '';
  return {
    status: google,
    reason: (REASONS as readonly string[]).includes(raw) ? raw : 'unknown',
  };
}

/**
 * A fonte de dados do workspace: conectar, escolher a property, ver o estado.
 *
 * Três estados, e o do meio é o que a Parte anterior não tinha: entre autorizar
 * no Google e escolher a property, a fonte existe e não mede nada. Dizer isso
 * na tela é o que evita o fundador esperar por um número que nunca vem.
 */
export function Ga4SourceCard() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [banner, setBanner] = useState(readReturn);

  // Lido uma vez e apagado: um F5 não pode ressuscitar a mensagem de uma
  // conexão que aconteceu há dez minutos.
  useEffect(() => {
    if (!banner) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('google');
    url.searchParams.delete('reason');
    window.history.replaceState({}, '', url.toString());
  }, [banner]);

  const integrations = useListIntegrations();
  const connected = integrations.data?.integrations.find((row) => row.provider === PROVIDER) ?? null;
  const hasProperty = Boolean(connected?.externalId);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: listIntegrationsQueryKey() });

  const disconnect = useRemoveIntegration({
    mutation: {
      onMutate: () => setError(null),
      onSuccess: async () => {
        setPicking(false);
        await invalidate();
      },
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

        {banner?.status === 'connected' && (
          <p className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
            {t('pages.integrations.google.connectedBanner')}
          </p>
        )}
        {banner?.status === 'error' && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p>{t('pages.integrations.google.errorBanner')}</p>
            <p className="text-muted-foreground">{t(`pages.integrations.google.reason.${banner.reason}`)}</p>
          </div>
        )}

        {integrations.isLoading && <SectionLoading />}
        {(integrations.isError || (!integrations.isLoading && !integrations.data)) && (
          <SectionLoadError refetch={[integrations.refetch]} />
        )}

        {/* Estado 1: nada conectado. */}
        {integrations.data && !connected && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('pages.integrations.empty')}</p>
            <GoogleConnectButton label={t('pages.integrations.google.connect')} onError={setError} />
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm">{t('pages.integrations.google.advanced')}</summary>
              <p className="mt-2 text-xs text-muted-foreground">{t('pages.integrations.google.advancedHint')}</p>
              <div className="mt-3">
                <ServiceAccountForm onConnected={invalidate} onError={setError} />
              </div>
            </details>
          </div>
        )}

        {/* Estado 2 e 3: conectado. */}
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

            {hasProperty && !picking && (
              <>
                <div>
                  <p className="text-sm font-medium">{t('pages.integrations.property')}</p>
                  <p className="font-mono text-sm text-muted-foreground">{connected.externalId}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setPicking(true)}>
                  {t('pages.integrations.picker.change')}
                </Button>
              </>
            )}

            {/* Conectado sem property: o estado que não existia antes, dito na
                tela em vez de descoberto na hora de medir. */}
            {!hasProperty && (
              <p className="text-sm text-muted-foreground">{t('pages.integrations.picker.noneChosen')}</p>
            )}

            {(picking || !hasProperty) && (
              <PropertyPicker
                current={connected.externalId ?? null}
                onSelected={() => setPicking(false)}
                {...(hasProperty ? { onCancel: () => setPicking(false) } : {})}
              />
            )}

            {connected.lastError && <p className="text-sm text-destructive">{connected.lastError}</p>}

            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <GoogleConnectButton
                label={t('pages.integrations.google.connect')}
                onError={setError}
                // Substituir é destrutivo: a confirmação vem antes de qualquer
                // requisição.
                onBeforeStart={() => {
                  setConfirmReplace(true);
                  return false;
                }}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={disconnect.isPending}
                onClick={() => disconnect.mutate({ params: { provider: PROVIDER } })}
              >
                {t('pages.integrations.disconnect')}
              </Button>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <AlertDialog open={confirmReplace} onOpenChange={setConfirmReplace}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('pages.integrations.replace.title')}</AlertDialogTitle>
              <AlertDialogDescription>{t('pages.integrations.replace.body')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('pages.integrations.replace.cancel')}</AlertDialogCancel>
              <AlertDialogAction asChild>
                <GoogleConnectButton label={t('pages.integrations.replace.confirm')} onError={setError} />
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
```

Confira `components/ui/alert-dialog.tsx` e use exatamente os subcomponentes que ele exporta. Se `AlertDialogAction asChild` com um botão que dispara mutação der problema de foco/fechamento, coloque o `GoogleConnectButton` no corpo do diálogo e deixe o `AlertDialogCancel` como única ação do footer — o teste que importa é "nada é pedido ao servidor antes da confirmação".

- [ ] **Step 4: Página, e apague o card antigo**

`web/src/pages/IntegrationsPage.tsx` — troque o import e o uso de `Ga4ConnectionCard` por `Ga4SourceCard`.

```bash
cd web && git rm src/components/integrations/Ga4ConnectionCard.tsx src/components/integrations/Ga4ConnectionCard.test.tsx
```

Antes de apagar, confirme que todo caso do teste antigo tem equivalente em `ServiceAccountForm.test.tsx` (Task 6) ou em `Ga4SourceCard.test.tsx`. Um caso que só existia lá e não foi migrado é cobertura perdida — **liste no relatório** qualquer caso que você decidiu não migrar, e por quê.

- [ ] **Step 5: Rode a suíte inteira do web**

Run: `cd web && pnpm typecheck && pnpm test`
Expected: tsc 0, suíte verde. Baseline: **701 testes / 93 arquivos**. **Rode sozinha**, não em paralelo com a do back.

- [ ] **Step 6: Stage e mostre o diff (NÃO comite)**

```bash
cd web && git add src/components/integrations src/pages/IntegrationsPage.tsx && git status --short && git diff --cached --stat
```

Mensagem sugerida: `feat(web): a real page for connecting the data source`

---

## Verificação final (depois das sete tasks)

- [ ] `cd back && pnpm typecheck && pnpm test` — tsc 0, suíte verde
- [ ] `cd back && pnpm prisma migrate status` — "Database schema is up to date!"
- [ ] `cd web && pnpm typecheck && pnpm test` — tsc 0, suíte verde (sozinha)
- [ ] `cd back && pnpm openapi:dump && cd ../web && pnpm api:generate` — sem diff pendente depois de rodados
- [ ] Nenhum escopo de escrita pedido: `grep -rn "analytics.edit\|analytics.manage\|analytics.provision" back/src` sai vazio
- [ ] O callback não é chamado pelo frontend: `grep -rn "google/callback" web/src` sai vazio
- [ ] Nenhum segredo em resposta: `grep -rn "refresh_token" back/src/http | grep -v test` só deve aparecer em `google-callback.controller.ts` (onde é selado) e em `google-client.ts` (onde é revogado)
- [ ] Nenhum teste toca a rede: `grep -rn "accounts.google.com\|oauth2.googleapis\|analyticsadmin" back/src --include=*.test.ts` só deve listar asserções sobre urls, nunca `fetch` real

## Fora de escopo (decidido no spec)

Verificação do app no Google (processo com terceiro); rotação de refresh token; múltiplas properties por workspace; segunda fonte; OAuth para escrita em qualquer produto Google; login com Google no próprio AUREA.

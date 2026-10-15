# Sub-projeto B2a — Ledger de créditos e BYOK

**Data:** 2026-07-27
**Status:** aprovado no brainstorm, pronto para plano
**Depende de:** B1 (`2026-07-27-ai-foundation-b1-design.md`), mergeado em `master` (`4c61b94`)

---

## 1. Contexto

O B1 entregou a máquina que executa uma tarefa de raciocínio contra um modelo, com
registro, custo e guardrail. Ela executa **sem teto**: `AiPolicy.authorizeRun` sempre
libera e `resolveProviderCredentials` sempre devolve a chave da plataforma. Um único
workspace pesado pode, hoje, levar a margem bruta a negativo — exatamente o que
`docs/product/business-model.md` §5 chama de não-negociável.

O B foi partido em B1 (execução) e B2 (controle comercial). No brainstorm de hoje o B2
foi partido de novo, porque o usuário quer Stripe com assinatura e cupom:

- **B2a (este spec)** — franquia mensal, ledger de créditos com bloqueio e estorno,
  BYOK cifrada. Nenhum dinheiro se move: a franquia vem do plano configurado em código.
- **B2b (spec futuro)** — Stripe: Customer, assinatura, cupom e compra de pacote de
  crédito, escrevendo no ledger que o B2a define.

O B2a protege a margem e destrava os sub-projetos C e D sem depender de gateway.

---

## 2. O que o B2a é e o que não é

**É** a resposta a duas perguntas, feitas antes de qualquer token ser gasto: *este
workspace pode gastar?* e *com a chave de quem?*

**Não é** cobrança. Não fala com gateway, não emite fatura, não gerencia assinatura.

Não-objetivos explícitos: Stripe, assinatura, cupom, upgrade/downgrade de plano,
cobrança de overage, alerta de saldo baixo, UI, admin de plataforma, role nova.

---

## 3. Decisões herdadas (não re-litigar)

Do spec do A e do B1:

- Chave de IA híbrida: plataforma por default, BYOK opcional.
- Crédito **por operação**, não por token: 1 seção = 1 crédito, run global = 9.
- Franquia mensal por plano. BYOK não consome crédito.
- Vertical slice por caso de uso no `src/http/api/`, erro no catálogo com paridade nos
  três locales, teste antes da implementação.

Decididas neste brainstorm:

- **Débito no `authorizeRun`, estorno em `FAILED`.** O débito é `check-and-debit`
  atômico: é o único ponto anterior ao gasto, e resolve concorrência de graça.
- **Dois baldes com virada preguiçosa.** Franquia do mês (expira) e saldo comprado
  (não expira). Consome franquia primeiro. Sem cron: a virada acontece na primeira
  autorização do mês.
- **BYOK por workspace**, gravada por OWNER/ADMIN. Não por organização: o `TenantContext`
  que chega no runner é de workspace, e um workspace precisa poder ter chave própria.
- **Âncora do preço: esforço percebido.** 1 crédito = uma ação pequena que o usuário
  reconhece (preencher um campo, resumir uma coisa); ação composta custa a soma das
  partes (9 seções = 9 créditos). O preço não acompanha COGS: trocar de provider não pode
  mudar o que o cliente vê. A conferência de margem é o `estimatedCost` do `AgentRun`,
  interno.
- **Custo em créditos na tela antes do clique.** A UI mostra quantos créditos a ação
  consome e quantos restam, sem o usuário precisar tentar para descobrir. Isso obriga o
  catálogo a ser legível pela API, não só pelo runner — daí a rota de pricing em §7.
  **Token e dinheiro nunca aparecem para o cliente:** `estimatedCost`, tokens e preço de
  modelo são auditoria interna, ficam no `AgentRun` e fora de qualquer resposta HTTP de
  billing.
- **Franquia por plano:** `STARTER` 200, `GROWTH` 1000, `SCALE` 4000 créditos/mês.
  Calibrada por folga, não por custo: no preço do DeepSeek um mês inteiro de `SCALE` custa
  ~$24 de token contra ~$460 de receita. Quem estoura é quem deve subir de plano.
- **Recarga por função de domínio exposta só em CLI.** Sem rota administrativa e sem
  role de plataforma: uma rota que concede saldo precisa de autoridade que vive fora do
  workspace, e inventar isso agora é escopo alheio. O B2b faz a reconciliação do Stripe
  chamar a mesma função.

---

## 4. Arquitetura

### 4.1 Fluxo

```text
POST /agent-runs → serviço cria AgentRun PENDING → fila
                                                    │
                                              worker → executeAgentRun
                                                    │
                              policy.authorizeRun(tenant, taskType)
                                                    │
                                    ┌───────────────┴───────────────┐
                            BYOK ativa?                        sem BYOK
                                    │                               │
                        autoriza sem debitar          transação: franquia → comprado
                                    │                               │
                                    │                     cobre?  ──┴── não → FAILED
                                    │                       │              (sem chamar modelo)
                                    │                      sim
                                    │                       │
                                    └───────────┬───────────┘
                                                │
                              policy.resolveProviderCredentials
                                                │
                            BYOK decifrada  ou  chave da plataforma
                                                │
                                          loop de modelo (B1)
                                                │
                                    COMPLETED ──┴── FAILED → REFUND
```

O runner **não muda**. As duas costuras do B1 (§4.5 daquele spec) passam a ter
implementação real; o caminho de execução é o mesmo.

### 4.2 Layout

```text
src/billing/
  plan-catalog.ts          Plan → franquia mensal
  operation-cost.ts        taskType → créditos
  crypto.ts                selar/abrir segredo (AES-256-GCM)
  credit.repository.ts     acesso a CreditPeriod e CreditLedger
  credit.service.ts        autorizar, debitar, estornar, conceder
  provider-key.repository.ts
  provider-key.service.ts  gravar (com validação), ler status, apagar

src/ai/policy.ts           adaptador: TenantContext + taskType → billing

src/http/api/credits/      GET /credits, GET /credits/ledger
src/http/api/provider-key/ GET|PUT|DELETE /ai/provider-key

src/scripts/grant-credits.ts   pnpm ai:grant
```

`src/ai/` não ganha lógica de cobrança. `src/billing/` não conhece Fastify nem o runner.

### 4.3 Contrato do billing

```ts
export type CreditCharge = {
  credits: number;
  fromAllowance: number;
  fromPurchased: number;
  ledgerEntryId: string;
};

export type AuthorizeResult =
  | { allowed: true; charge: CreditCharge | null }   // null = BYOK, não debitou
  | { allowed: false; required: number; available: number };

export type CreditSummary = {
  plan: Plan;
  allowance: number;        // franquia do período corrente
  consumed: number;
  purchasedBalance: number;
  periodStart: Date;
  periodEnd: Date;          // exclusivo: 1º do mês seguinte
};

export type CreditService = {
  authorizeAndCharge(input: {
    workspaceId: string;
    taskType: string;
    agentRunId: string;
    byok: boolean;
    now: Date;
  }): Promise<AuthorizeResult>;

  refund(input: { agentRunId: string; now: Date }): Promise<void>;   // idempotente
  grant(input: { workspaceId: string; credits: number; reason: string }): Promise<void>;
  summary(workspaceId: string, now: Date): Promise<CreditSummary>;
};
```

`now` entra por parâmetro em tudo que depende do mês: virada de período testável sem
relógio falso.

### 4.4 Mudança nas costuras do B1

As duas assinaturas do B1 não bastam, e a diferença é pequena o suficiente para caber
aqui em vez de virar retrofit:

```ts
export type AiPolicy = {
  // B1: (tenant, taskType). O ledger precisa saber em que run lançar o débito,
  // e se existe BYOK para o provider daquele tier — as duas coisas o runner já
  // tem em mãos no ponto da chamada.
  authorizeRun(
    tenant: TenantContext,
    input: { taskType: string; agentRunId: string; provider: string },
  ): Promise<RunAuthorization>;

  resolveProviderCredentials(tenant: TenantContext, provider: string): Promise<ProviderCredentials>;

  // Novo: o runner avisa que o run terminou mal, e a policy decide o que isso
  // significa comercialmente. No B2a, estorno.
  onRunFailed(tenant: TenantContext, agentRunId: string): Promise<void>;
};
```

`RunAuthorization` ganha os números do bloqueio:
`{ allowed: false; reason: string; required: number; available: number }`.

No runner isso são três linhas: passar `agentRunId` e `entry.provider` na autorização
(o `entry` já está resolvido antes), e chamar `onRunFailed` dentro do `fail()`. O laço de
modelo, o guardrail e o loop de tools não são tocados.

---

## 5. Modelo de dados

Uma migration.

### 5.1 Plano no workspace

```prisma
enum Plan {
  STARTER
  GROWTH
  SCALE
}

model Workspace {
  // ...
  plan Plan @default(STARTER)
}
```

Workspaces existentes nascem `STARTER` pelo default. Sem backfill.

A franquia de cada plano vive em `src/billing/plan-catalog.ts`, não no banco — mesma
razão do catálogo de modelos do B1: mudar o que um plano dá é decisão de produto que
passa por revisão de código, não `UPDATE` solto.

### 5.2 Período de franquia

```prisma
model CreditPeriod {
  id          String   @id @default(uuid())
  workspaceId String
  periodStart DateTime           // 1º do mês, 00:00 UTC
  allowance   Int                // congelado do plano na virada
  consumed    Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, periodStart])
}
```

`allowance` é congelado: se o plano mudar no meio do mês, o mês corrente mantém o que
foi prometido na virada. Franquia não usada morre — não rola para o mês seguinte.

### 5.3 Ledger

```prisma
enum CreditEntryKind {
  DEBIT      // consumo de run
  REFUND     // devolução de run que falhou
  PURCHASE   // compra (B2b)
  GRANT      // concessão manual (CLI)
}

model CreditLedger {
  id           String          @id @default(uuid())
  workspaceId  String
  kind         CreditEntryKind
  credits      Int             // negativo em DEBIT, positivo no resto
  fromAllowance Int   @default(0)   // quanto do débito saiu da franquia
  fromPurchased Int   @default(0)   // quanto saiu do saldo comprado
  agentRunId   String?
  reason       String
  createdAt    DateTime        @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId, createdAt])
  @@unique([agentRunId, kind])   // um DEBIT e um REFUND por run, no máximo
}
```

Append-only: nada de `UPDATE`, nada de `DELETE`. O extrato é a explicação de "cadê meu
crédito" e a base de auditoria.

`@@unique([agentRunId, kind])` é o que torna o estorno idempotente sem lógica extra: uma
retentativa de job que tente estornar duas vezes bate no índice.

Saldo comprado, em SQL agregado (nunca somando linhas em memória):

```text
purchasedBalance = Σ credits (PURCHASE, GRANT)
                 − Σ fromPurchased (DEBIT)
                 + Σ fromPurchased (REFUND)
```

`credits` é assinado (negativo em `DEBIT`) e serve para o extrato; as colunas
`fromAllowance`/`fromPurchased` são sempre positivas e servem para o saldo. A redundância
é proposital: o extrato mostra o movimento como o cliente pensa, e o saldo se calcula sem
reinterpretar sinal.

### 5.4 Chave BYOK

```prisma
model WorkspaceProviderKey {
  id          String   @id @default(uuid())
  workspaceId String
  provider    String              // 'deepseek'
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

Sem coluna que guarde a chave em claro, e `last4` é o único pedaço que sai da API.

---

## 6. Execução

### 6.1 Virada de período

Na autorização, `credit.service` pega (ou cria) a linha de `CreditPeriod` do mês corrente
com `allowance` lido do catálogo pelo plano atual do workspace. Criação e débito na mesma
transação; conflito de `@@unique` numa corrida vira releitura da linha existente.

Nada de cron: um workspace inativo não tem linha nenhuma, e isso está certo — período sem
consumo não é informação.

### 6.2 Débito

Transação única:

1. `SELECT ... FOR UPDATE` na linha do período (bloqueio pessimista por workspace).
2. `fromAllowance = min(custo, allowance - consumed)`.
3. `fromPurchased = custo - fromAllowance`, verificado contra o saldo comprado.
4. Não cobre → devolve `{ allowed: false, required, available }`, sem escrever nada.
5. Cobre → `consumed += fromAllowance`, insere `DEBIT`.

O `FOR UPDATE` serializa por workspace. Dois runs simultâneos com 1 crédito: um passa, o
outro é bloqueado. Isso é o caso que teste com repo fake não prova — vai para o teste de
integração contra Postgres real.

### 6.3 Estorno

`fail()` no runner chama `policy.onRunFailed`, que dispara `refund(agentRunId)`. O estorno
devolve exatamente o que saiu de cada balde: `fromPurchased` volta como lançamento
positivo, e `fromAllowance` decrementa o `consumed` **do período em que o débito foi
lançado** — localizado pelo `createdAt` do `DEBIT`, não pela data do estorno. Um run que
começou dia 31 e falhou dia 1º devolve franquia ao mês que a cobrou; se aquele mês já
virou, a devolução não vale nada na prática, e está certo assim: a franquia era daquele
mês.

Run `FAILED` por falta de crédito não gera estorno — não houve débito.

Falha nossa não é cobrança do cliente. O token queimado numa falha aparece em
`AgentRun.estimatedCost` como prejuízo visível, que é onde ele deve doer.

### 6.4 BYOK

`resolveProviderCredentials` busca `WorkspaceProviderKey` do par (workspace, provider). Se
existe, decifra e devolve `source: 'BYOK'`. Se não, cai na chave da plataforma com
`source: 'PLATFORM'`, como no B1.

`authorizeRun` recebe o mesmo sinal: com BYOK ativa não há débito, porque o cliente está
pagando o provider direto.

Consequência a documentar na UI (B2b/C): apagar a chave BYOK faz os runs seguintes
voltarem a consumir crédito.

### 6.5 Validação da chave no `PUT`

Antes de cifrar, o serviço faz uma chamada barata ao provider (uma completion mínima com
`max_tokens` baixo) usando a chave recebida. Reprovou → `AUR-T0014`, nada é gravado.

Chave errada aceita em silêncio só apareceria como run `FAILED` horas depois, com o
usuário sem pista do porquê.

---

## 7. Contratos HTTP

Todas sob `authenticate` + `resolveTenant`.

| Rota | `operationId` | Papel | Resposta |
|---|---|---|---|
| `GET /credits` | `getCredits` | qualquer membro | plano, `allowance`, `consumed`, `purchasedBalance`, `periodStart`, `periodEnd` |
| `GET /credits/ledger` | `listCreditLedger` | qualquer membro | página de lançamentos por cursor (`createdAt`+`id`), mais recente primeiro |
| `GET /credits/pricing` | `getCreditPricing` | qualquer membro | catálogo `taskType → créditos`, para a tela dizer o custo em créditos antes do clique |
| `GET /credits/pricing` | `getCreditPricing` | qualquer membro | catálogo `taskType → créditos`, para a tela dizer o preço antes do clique |
| `GET /ai/provider-key` | `getProviderKey` | OWNER/ADMIN | `{ configured: false }` ou `{ configured: true, provider, last4, createdAt }` |
| `PUT /ai/provider-key` | `putProviderKey` | OWNER/ADMIN | grava/rotaciona após validar; devolve o mesmo shape do `GET` |
| `DELETE /ai/provider-key` | `deleteProviderKey` | OWNER/ADMIN | 204 |

`GET /credits` é leitura de qualquer membro, inclusive VIEWER: saber quanto resta não é
ação de escrita. Já a chave é OWNER/ADMIN até para ler o `last4`.

---

## 8. Erros

Catálogo + três locales, com o teste de paridade que o B1 já usa.

| Código | Chave | HTTP | Params |
|---|---|---|---|
| `AUR-T0013` | `INSUFFICIENT_CREDITS` | 402 | `required`, `available` |
| `AUR-T0014` | `INVALID_PROVIDER_KEY` | 400 | `provider` |
| `AUR-T0015` | `ENCRYPTION_NOT_CONFIGURED` | 500 | — |

`INSUFFICIENT_CREDITS` carrega os números porque a tela precisa dizer quanto falta, não
só "acabou". Ele também vira o `error` do `AgentRun` que falhou por saldo — o mesmo texto
que o cliente lê no extrato.

---

## 9. Segurança

- **Cifra:** AES-256-GCM. Master key em `AI_KEY_ENCRYPTION_KEY`, 32 bytes em base64,
  validada no boot pelo `env.ts` (tamanho errado derruba o processo, não a primeira
  requisição). IV aleatório de 12 bytes por gravação, nunca reusado. `authTag` guardado.
- **Sem KMS:** o deploy é VPS Oracle, não há serviço de chave gerenciada. Rotação da
  master key é procedimento manual documentado (redecifrar e regravar), não código deste
  spec.
- **A chave nunca sai:** não há rota que devolva a chave, e o presenter não tem acesso ao
  campo. `last4` é derivado na gravação.
- **Log:** nada de `ciphertext`, `iv` ou chave em log. O erro de decifra loga
  `workspaceId` e `provider`, nunca conteúdo.
- **Escalada de privilégio:** `grant` só existe em CLI. Não há caminho HTTP que aumente
  saldo no B2a.

---

## 10. Testes

Unidade, com fake de repositório:

- `crypto.ts`: round-trip; ciphertext ≠ plaintext; `authTag` adulterado falha; master key
  errada falha; dois selamentos da mesma chave têm IV diferente.
- `plan-catalog` / `operation-cost`: todo `Plan` tem franquia; `taskType` desconhecido é
  erro explícito, não custo zero silencioso.
- `credit.service`: consome franquia primeiro; sobra vai para o comprado; bloqueia com
  `required`/`available` corretos; BYOK não debita; estorno devolve a cada balde o que
  saiu; estorno duplicado não duplica; virada de mês cria período com `allowance` do plano
  corrente; plano trocado no meio do mês não altera o período em curso.
- `provider-key.service`: chave inválida não é gravada; gravação sobre chave existente
  rotaciona; `last4` confere.

Integração contra Postgres real (o que fake nenhum prova):

- duas autorizações concorrentes com 1 crédito → exatamente um `DEBIT` e um bloqueio;
- duas criações concorrentes de período → uma linha só.

Rotas por `app.inject`: papéis (VIEWER lê saldo, VIEWER não lê chave, MEMBER não grava
chave), isolamento de workspace, e o teste que garante que nenhuma resposta contém a
chave.

Runner: teste que prova que run bloqueado por saldo termina `FAILED` **sem** chamar o
provider, e que run que falha depois de debitar gera `REFUND`.

---

## 11. Configuração nova

| Variável | Obrigatória | Nota |
|---|---|---|
| `AI_KEY_ENCRYPTION_KEY` | sim, se BYOK ligado | 32 bytes em base64; boot falha se malformada |

Nenhuma outra. Franquia e custo por operação são código.

---

## 12. Riscos e itens abertos

- **Franquia congelada vs plano trocado.** Decidido: o mês corrente mantém o `allowance`
  da virada. Upgrade no meio do mês não dá crédito extra imediato — o B2b, que é quem vai
  vender upgrade, provavelmente vai querer conceder a diferença como `GRANT`. Fica
  registrado como entrada do B2b, não como pendência aqui.
- **`FOR UPDATE` por workspace** serializa autorizações do mesmo workspace. Com o volume
  esperado (runs de segundos, poucos por minuto por workspace) isso é irrelevante; se um
  dia virar gargalo, a saída é débito otimista com retry, não índice novo.
- **Validação da chave no `PUT`** gasta uma chamada real ao provider por gravação. É
  barata e rara; o alternativo (aceitar às cegas) foi rejeitado.
- **Custo por operação é fixo por `taskType`.** Um run que escala de tier custa mais
  dinheiro e o mesmo crédito. Aceito: crédito é preço ao cliente, `estimatedCost` é COGS,
  e a margem se defende no catálogo de planos, não por run.

---

## 13. Entrada do B2b

O B2b não redesenha nada disto. Ele acrescenta:

- `StripeCustomer` ligado ao usuário/organização, criado pelo e-mail;
- reconciliação por *pull* (sem webhook, como pedido): ler assinatura e sessões de
  checkout pagas, e para cada uma ainda não reconciliada chamar `grant` com o id do objeto
  Stripe como `reason` — a idempotência sai do índice do ledger;
- assinatura e cupom mapeados para `Workspace.plan`.

O ponto de contato é uma função: `grant`. Nada em `src/billing/credit.service.ts` precisa
saber que Stripe existe.

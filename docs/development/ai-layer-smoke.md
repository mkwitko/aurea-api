# Smoke da camada de IA (B1)

Roda o agente canary contra o DeepSeek real. **Não** faz parte de `pnpm test`:
CI não tem chave e não deve gastar dinheiro.

## Pré-requisitos

- `.env` com `AI_PROVIDER_API_KEY` e os três `AI_MODEL_TIER*`
- Postgres e Redis de pé: `pnpm infra:up`
- Um business com contexto salvo no workspace do usuário de teste

## Passos

```bash
pnpm dev

TOKEN=$(curl -s localhost:3337/auth/login -H 'content-type: application/json' \
  -d '{"email":"...","password":"..."}' | jq -r .accessToken)

RUN=$(curl -s localhost:3337/agent-runs -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"taskType":"summarize-business-context","input":{"businessId":"<uuid>"}}' | jq -r .id)

curl -s localhost:3337/agent-runs/$RUN -H "authorization: Bearer $TOKEN" | jq
```

## O que verificar

- `status` chega a `COMPLETED` em segundos
- `output` tem `summary`, exatamente 3 `risks` e `confidence`
- `model`, `estimatedCost` e os tokens estão preenchidos e coerentes
- No banco: `select name, ok, duration_ms from "AgentToolCall" where "agentRunId" = '<run>';`
  mostra ao menos uma chamada a `get_business_context` com `ok = true`
- O log da API tem uma linha `agent run completed` com custo, e **nenhuma** chave de API

## Falhas conhecidas e o que significam

| Sintoma | Causa provável |
|---|---|
| `FAILED` com `No AI provider key configured` | `AI_PROVIDER_API_KEY` ausente |
| `FAILED` com texto de schema | o modelo não devolveu o JSON esperado em 3 tentativas; ver `input`/`output` do run |
| `FAILED` com `model call budget exhausted` | o modelo ficou pedindo tools sem nunca responder; ver `AgentToolCall` do run |
| `FAILED` com `insufficient credits` | franquia do mês e saldo comprado zerados; ver `GET /credits`, e recarregar com `pnpm ai:grant` (ver o aviso sobre `--reason` abaixo) |
| Run parado em `PENDING` | worker desligado (`AI_WORKER_ENABLED=false`) ou Redis fora do ar |

## Recarga manual: `pnpm ai:grant`

```bash
pnpm ai:grant --workspace <id> --credits 500 --reason "cortesia suporte #1234"
```

**O `--reason` não pode começar com `plan change`.** O complemento de franquia de troca
de plano (B2b) identifica os lançamentos dele por `reason LIKE 'plan change%'` para saber
quanto o mês já recebeu. Um grant manual com esse prefixo entra nessa conta e **reduz, em
silêncio, um complemento legítimo posterior** — um cliente que subir de plano depois
recebe menos crédito do que pagou. A CLI recusa o prefixo, mas o motivo é este, e vale
para qualquer outra escrita direta no ledger.

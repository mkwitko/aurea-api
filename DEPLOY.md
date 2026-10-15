# AUREA API — Run & Deploy

The API (Fastify + Prisma + Postgres + Redis) runs as containers. The frontend
(`aurea-web-app`) is deployed separately on Cloudflare Pages and talks to this API
over HTTPS.

---

## 1. Run locally

```bash
docker compose up -d                 # Postgres + Redis
cp .env.example .env                 # fill JWT secrets: openssl rand -hex 32
pnpm install
pnpm prisma:migrate                  # create schema
pnpm dev                             # API on http://localhost:3333
```

Check: `curl http://localhost:3333/health` → `{"status":"ok"}`.

---

## 2. Deploy to an Oracle VPS (Docker Compose)

The production stack (`compose.prod.yml`) runs Postgres, Redis, the API, and
Caddy (automatic HTTPS) on one VPS. Works on Oracle Ampere (arm64) and x86.

### 2.1 Prerequisites on the VPS

```bash
# Install Docker + Compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"      # re-login after this
```

### 2.2 Open the ports (Oracle gotcha)

Oracle blocks inbound traffic in **two** places — you must open both:

1. **Cloud Console → VCN → Security List** (or Network Security Group): add
   ingress rules for TCP **80** and **443** from `0.0.0.0/0`.
2. **The instance firewall** (Oracle images ship with iptables/firewalld closed):

   Ubuntu images (iptables):
   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```
   Oracle Linux (firewalld):
   ```bash
   sudo firewall-cmd --permanent --add-service=http
   sudo firewall-cmd --permanent --add-service=https
   sudo firewall-cmd --reload
   ```

### 2.3 DNS

Point an A record for `api.yourdomain.com` at the VPS public IP. Caddy needs
this resolvable to issue a TLS certificate.

### 2.4 Deploy

```bash
git clone <this-repo-url> aurea-api && cd aurea-api
cp .env.prod.example .env.prod        # fill secrets, DATABASE_URL, API_DOMAIN, CORS_ORIGIN
chmod +x deploy.sh
./deploy.sh
```

`deploy.sh` builds the image, starts the stack, and the API container runs
`prisma migrate deploy` on boot. Caddy fetches HTTPS automatically.

Verify: `https://api.yourdomain.com/health`.

### 2.5 Updating

```bash
./deploy.sh          # git pull + rebuild + restart
```

---

## 3. CORS

`CORS_ORIGIN` in `.env.prod` must equal the Cloudflare Pages URL of the
frontend (e.g. `https://app.yourdomain.com`), or the browser blocks requests.

---

## 4. Backups (recommended)

```bash
# dump the database
docker compose -f compose.prod.yml exec postgres \
  pg_dump -U aurea aurea > backup-$(date +%F).sql
```

Schedule via cron and copy off the VPS (e.g. to Oracle Object Storage).

---

## 5. Stripe

Test mode. Os produtos e prices já existem na conta (`aurea_plan_*`, `aurea_pack_*`);
os ids vão em `.env` como `STRIPE_PRICE_*`.

Em desenvolvimento não há webhook sem túnel. Duas saídas:

```bash
# caminho real: a CLI do Stripe imprime o whsec_ que vai em STRIPE_WEBHOOK_SECRET
stripe listen --forward-to localhost:3337/webhooks/stripe
```

ou `POST /billing/sync`, que busca a assinatura corrente e as sessões pagas
recentes e aplica os mesmos handlers.

Em produção, cadastrar o endpoint `https://<API_DOMAIN>/webhooks/stripe` no
dashboard do Stripe, assinando **cinco** eventos:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

e pôr o segredo devolvido em `STRIPE_WEBHOOK_SECRET`.

`async_payment_succeeded` não é opcional se boleto ou Pix estiverem habilitados na
conta: com eles a sessão fecha `unpaid` e o dinheiro entra dias depois, só neste
evento. Sem assiná-lo, o cliente paga e nunca é creditado.

### 5.1 Variáveis obrigatórias

`APP_URL` é a base do `success_url`/`cancel_url` do checkout e do retorno do
portal — o endereço do **front**, não da API. O schema de env tem um default
`http://localhost:5173` que só serve para desenvolvimento; em
`NODE_ENV=production` um `APP_URL` de localhost **derruba o boot**, de propósito.
Esquecê-lo não pode significar redirecionar quem acabou de pagar para a máquina
de alguém. Os seis `STRIPE_PRICE_*` e as duas chaves estão em
`.env.prod.example`; sem `STRIPE_SECRET_KEY` as rotas de billing não existem, e
sem `STRIPE_WEBHOOK_SECRET` a rota do webhook não é registrada.

### 5.2 Esta release só vai para frente

A migration do B2b **dropa `Workspace.plan`** depois de copiar o valor para
`Organization`. O container roda `prisma migrate deploy` no boot (§2.4), então no
instante em que a imagem nova sobe a coluna já não existe — e **a imagem anterior
não sobe mais**, porque o `credit.repository` dela ainda faz `SELECT` na coluna
dropada. Rollback de imagem não é uma saída aqui.

Antes de subir esta release:

```bash
# dump ANTES do deploy: é o único caminho de volta
docker compose -f compose.prod.yml exec postgres \
  pg_dump -U aurea aurea > pre-b2b-$(date +%F).sql
```

Se algo der errado, o caminho é para frente (corrigir e redeployar) ou restaurar o
dump — não voltar a imagem.

**Uma falha desta release parece pior do que é.** O `Dockerfile` roda
`prisma migrate deploy` **antes** de `node dist/server.js`, e a validação de env acontece
no boot do processo. Num `.env.prod` que ainda não tem `APP_URL`, a ordem é: a migration
destrutiva aplica, e só então o processo morre na validação — crash-loop com a coluna
antiga já removida. Isso **não** é caso de restaurar o dump: o banco está correto e
migrado. Basta acrescentar a linha `APP_URL=https://app.seudominio.com` (e os
`STRIPE_*` que faltarem) ao `.env.prod` e reiniciar a stack. Mesma coisa para qualquer
outra variável obrigatória ausente.

A mesma migration cria um `CREATE UNIQUE INDEX` em `Organization.stripeCustomerId`.
Não é `CONCURRENTLY`: ele toma um lock de escrita na tabela enquanto constrói.
Irrelevante no tamanho atual (dezenas de linhas), mas é o tipo de coisa que passa a
importar com centenas de milhares — nesse dia, criar o índice fora da migration,
com `CONCURRENTLY`.

Smoke test manual de ponta a ponta (test mode, não roda em CI): ver
`docs/development/billing-b2b-smoke.md`.

---

## 6. Logs & ops

```bash
docker compose -f compose.prod.yml logs -f api      # API logs
docker compose -f compose.prod.yml ps               # status
docker compose -f compose.prod.yml down             # stop
```

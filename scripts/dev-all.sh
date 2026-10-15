#!/usr/bin/env bash
# Sobe todo o ambiente de desenvolvimento da AUREA com um único comando:
#   infra Docker (Postgres, Redis, Langfuse) -> migrations -> API -> worker -> web
#
# Uso:
#   pnpm dev:all              # tudo
#   SKIP_WEB=1 pnpm dev:all   # sem o frontend
#   SKIP_INFRA=1 pnpm dev:all # sem docker/migrations (containers já rodando)
#
# Ctrl-C encerra todos os processos de uma vez. Os containers continuam de pé;
# use `pnpm infra:down` para derrubá-los.

set -euo pipefail

BACK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$(cd "$BACK_DIR/../web" 2>/dev/null && pwd || true)"
cd "$BACK_DIR"

API_PORT="$(grep -E '^API_PORT=' .env 2>/dev/null | cut -d= -f2 || true)"
API_PORT="${API_PORT:-3333}"

log() { printf '\033[1;36m▸ %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$1"; }

# Um processo em background com prefixo colorido nos logs.
pids=()
run() {
  local name="$1" color="$2" dir="$3"
  shift 3
  (
    trap - INT TERM EXIT # o subshell herda o trap do pai e chamaria cleanup de novo
    cd "$dir"
    "$@" 2>&1 | while IFS= read -r line; do
      printf '\033[%sm[%s]\033[0m %s\n' "$color" "$name" "$line"
    done
  ) &
  pids+=($!)
}

# tsx/vite rodam como netos deste script, então mata a árvore inteira.
kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null || true
}

cleanup() {
  trap - INT TERM EXIT
  log 'encerrando processos…'
  for pid in "${pids[@]:-}"; do
    [ -n "$pid" ] && kill_tree "$pid"
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

if [ "${SKIP_INFRA:-}" != '1' ]; then
  # O container `api` do compose.local.yml disputa a porta da API com o tsx watch.
  if docker compose -f compose.local.yml ps --status running --status restarting -q api 2>/dev/null | grep -q .; then
    warn "container 'api' (compose.local.yml) está rodando e conflita com a API local; pare com: pnpm docker:down"
  fi

  log 'subindo infra (postgres, redis, langfuse)…'
  docker compose up -d

  log 'aguardando postgres…'
  for _ in $(seq 1 60); do
    if docker compose exec -T postgres pg_isready -U aurea >/dev/null 2>&1; then break; fi
    sleep 1
  done

  # O Langfuse guarda os dados em um database próprio no mesmo Postgres.
  docker compose exec -T postgres psql -U aurea -d postgres \
    -c "SELECT 1 FROM pg_database WHERE datname = 'langfuse'" 2>/dev/null | grep -q '1 row' ||
    docker compose exec -T postgres createdb -U aurea langfuse 2>/dev/null || true

  log 'aplicando migrations…'
  pnpm prisma:generate >/dev/null
  pnpm prisma:deploy
fi

log 'iniciando processos'
run api    '1;32' "$BACK_DIR" pnpm dev
run worker '1;35' "$BACK_DIR" pnpm worker
if [ "${SKIP_WEB:-}" != '1' ] && [ -n "$WEB_DIR" ] && [ -d "$WEB_DIR/node_modules" ]; then
  run web '1;34' "$WEB_DIR" pnpm dev
elif [ "${SKIP_WEB:-}" != '1' ]; then
  warn "web não iniciado (rode 'pnpm install' em ../web)"
fi

cat <<EOF

  web        http://localhost:5173
  api        http://localhost:${API_PORT}      (docs: /docs)
  langfuse   http://localhost:3050    dev@aurea.local / aurealocal123
  postgres   localhost:5434           redis  localhost:6380

  Ctrl-C encerra tudo.

EOF

wait

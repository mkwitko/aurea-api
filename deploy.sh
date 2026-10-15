#!/usr/bin/env bash
# Deploy / update the AUREA API on the VPS.
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env.prod ]; then
  echo "Missing .env.prod — copy .env.prod.example and fill it first." >&2
  exit 1
fi

echo "Pulling latest code..."
git pull --ff-only

echo "Building and starting containers..."
docker compose -f compose.prod.yml --env-file .env.prod up -d --build

echo "Pruning old images..."
docker image prune -f

echo "Done. Logs: docker compose -f compose.prod.yml logs -f api"

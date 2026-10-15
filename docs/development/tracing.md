# Tracing (Langfuse)

Every agent run leaves one trace, named by `taskType`, with a span per model
call, tool call, guardrail rejection, and `verifyOutput` rejection. See
`src/integrations/tracing/` — the runner depends only on our own
`startRunTrace()` interface, never on Langfuse's types.

## Env vars

All three are required together; missing any one of them disables tracing
entirely (silent no-op — never a precondition for a run to work):

```
LANGFUSE_SECRET_KEY=
LANGFUSE_PUBLIC_KEY=
LANGFUSE_BASEURL=http://localhost:3050
```

There is no cloud default: a key without a `LANGFUSE_BASEURL` would otherwise
send traces to Langfuse Cloud, which is exactly what self-hosting exists to
avoid — traces carry customer business context.

## Self-hosting, next to Postgres and Redis

Add to `docker-compose.yml` (adapted from Langfuse's own self-hosting compose
— see https://langfuse.com/self-hosting for the full reference and secret
rotation). Reuses the existing `postgres`/`redis` services; only ClickHouse
and MinIO are new:

```yaml
  langfuse-clickhouse:
    image: clickhouse/clickhouse-server:25.12
    environment:
      CLICKHOUSE_DB: default
      CLICKHOUSE_USER: clickhouse
      CLICKHOUSE_PASSWORD: clickhouse # CHANGEME
    volumes:
      - langfuse_clickhouse:/var/lib/clickhouse

  langfuse-minio:
    image: minio/minio
    entrypoint: sh
    command: -c 'mkdir -p /data/langfuse && minio server --address ":9000" --console-address ":9001" /data'
    environment:
      MINIO_ROOT_USER: minio
      MINIO_ROOT_PASSWORD: miniosecret # CHANGEME
    volumes:
      - langfuse_minio:/data

  langfuse-worker:
    image: langfuse/langfuse-worker:4
    depends_on: [postgres, redis, langfuse-clickhouse, langfuse-minio]
    environment: &langfuse-env
      DATABASE_URL: postgresql://aurea:aurea@postgres:5432/langfuse
      SALT: mysalt # CHANGEME: openssl rand -hex 32
      ENCRYPTION_KEY: '0000000000000000000000000000000000000000000000000000000000000000' # CHANGEME
      CLICKHOUSE_URL: http://langfuse-clickhouse:8123
      CLICKHOUSE_USER: clickhouse
      CLICKHOUSE_PASSWORD: clickhouse # CHANGEME
      REDIS_HOST: redis
      LANGFUSE_S3_EVENT_UPLOAD_BUCKET: langfuse
      LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT: http://langfuse-minio:9000
      LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID: minio
      LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY: miniosecret # CHANGEME
      LANGFUSE_S3_EVENT_UPLOAD_FORCE_PATH_STYLE: 'true'

  langfuse-web:
    image: langfuse/langfuse:4
    depends_on: [langfuse-worker]
    ports: ['3050:3000']
    environment:
      <<: *langfuse-env
      NEXTAUTH_URL: http://localhost:3050
      NEXTAUTH_SECRET: mysecret # CHANGEME

volumes:
  langfuse_clickhouse:
  langfuse_minio:
```

Create the `langfuse` database in the existing `postgres` service first, then
create a project in the UI at `localhost:3050` and copy its public/secret
keys into `.env`.

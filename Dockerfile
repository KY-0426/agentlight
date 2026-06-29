# Agent Light — 单容器自包含（内置 PostgreSQL + API，零外部依赖）
# 构建上下文：仓库根目录
# 云托管：目标目录留空，Dockerfile 名称 Dockerfile，端口 8787
# 无需配置 DATABASE_URL / PostgreSQL，直接发布即可

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY packages/shared/package.json ./packages/shared/
RUN npm ci

FROM node:20-alpine AS runner
WORKDIR /app

RUN apk add --no-cache postgresql16 postgresql16-contrib wget su-exec

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    LOG_LEVEL=info \
    PGDATA=/var/lib/postgresql/data \
    DATABASE_URL=postgresql://agent_light:agent_light@127.0.0.1:5432/agent_light \
    ACCESS_TOKEN_SECRET=agent-light-builtin-access-token-secret-v1 \
    REFRESH_TOKEN_SECRET=agent-light-builtin-refresh-token-secret-v1

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY tsconfig.json tsconfig.node.json ./
COPY server/ ./server/
COPY packages/ ./packages/

RUN mkdir -p /var/lib/postgresql/data /run/postgresql \
    && chown -R postgres:postgres /var/lib/postgresql /run/postgresql

RUN cat > /docker-entrypoint.sh <<'EOF'
#!/bin/sh
set -e

export DATABASE_URL="${DATABASE_URL:-postgresql://agent_light:agent_light@127.0.0.1:5432/agent_light}"
export ACCESS_TOKEN_SECRET="${ACCESS_TOKEN_SECRET:-agent-light-builtin-access-token-secret-v1}"
export REFRESH_TOKEN_SECRET="${REFRESH_TOKEN_SECRET:-agent-light-builtin-refresh-token-secret-v1}"

PGDATA="${PGDATA:-/var/lib/postgresql/data}"

stop_postgres() {
  if [ -f "$PGDATA/postmaster.pid" ]; then
    su-exec postgres pg_ctl -D "$PGDATA" stop -m fast -w || true
  fi
}
trap stop_postgres EXIT TERM INT

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "Initializing embedded PostgreSQL..."
  su-exec postgres initdb -D "$PGDATA" -E UTF8 --locale=C
  {
    echo "listen_addresses = '127.0.0.1'"
    echo "port = 5432"
    echo "max_connections = 50"
    echo "shared_buffers = 64MB"
  } >> "$PGDATA/postgresql.conf"
  echo "host all all 127.0.0.1/32 trust" >> "$PGDATA/pg_hba.conf"
  echo "host all all ::1/128 trust" >> "$PGDATA/pg_hba.conf"
  echo "local all all trust" >> "$PGDATA/pg_hba.conf"
fi

echo "Starting embedded PostgreSQL..."
su-exec postgres pg_ctl -D "$PGDATA" -l /tmp/postgresql.log start -w

echo "Ensuring database role and database..."
su-exec postgres psql -v ON_ERROR_STOP=1 postgres <<'EOSQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'agent_light') THEN
    CREATE ROLE agent_light LOGIN PASSWORD 'agent_light';
  END IF;
END
$$;
SELECT 'CREATE DATABASE agent_light OWNER agent_light'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'agent_light')\gexec
GRANT ALL PRIVILEGES ON DATABASE agent_light TO agent_light;
EOSQL

echo "Running database migrations..."
cd /app/server
attempt=0
until npx drizzle-kit migrate; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "FATAL: database migration failed after 30 attempts" >&2
    exit 1
  fi
  echo "Migration not ready (attempt $attempt/30), retry in 2s..."
  sleep 2
done

echo "Starting Agent Light server on ${HOST}:${PORT}..."
cd /app
exec npx tsx server/src/index.ts
EOF
RUN chmod +x /docker-entrypoint.sh

VOLUME ["/var/lib/postgresql/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-8787}/health" || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]

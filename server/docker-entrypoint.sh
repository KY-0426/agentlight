#!/bin/sh
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "FATAL: DATABASE_URL is required" >&2
  echo "Example: mysql://user:pass@10.15.108.198:3306/agent_light" >&2
  exit 1
fi

case "$DATABASE_URL" in
  mysql://*)
    echo "Database: MySQL (external)"
    ;;
  *)
    echo "FATAL: DATABASE_URL must use mysql:// (this release no longer bundles PostgreSQL)" >&2
    exit 1
    ;;
esac

echo "Running database migrations..."
cd /app/server
attempt=0
until npx drizzle-kit migrate; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 10 ]; then
    echo "FATAL: database migration failed after 10 attempts" >&2
    exit 1
  fi
  echo "Migration not ready (attempt $attempt/10), retry in 3s..."
  sleep 3
done

echo "Starting Agent Light server on ${HOST:-0.0.0.0}:${PORT:-8787}..."
cd /app
exec npx tsx server/src/index.ts

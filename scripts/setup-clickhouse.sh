#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
elif [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${CLICKHOUSE_URL:?CLICKHOUSE_URL is required}"
: "${CLICKHOUSE_USERNAME:=default}"
: "${CLICKHOUSE_PASSWORD:?CLICKHOUSE_PASSWORD is required}"

if ! command -v clickhouse >/dev/null 2>&1; then
  echo "clickhouse binary not found on PATH. Install with: curl https://clickhouse.com/ | CLICKHOUSE_ONLY=1 sh" >&2
  exit 1
fi

HOST="$(python3 - <<'PY' "$CLICKHOUSE_URL"
from urllib.parse import urlparse
import sys
print(urlparse(sys.argv[1]).hostname or "127.0.0.1")
PY
)"
PORT="$(python3 - <<'PY' "$CLICKHOUSE_URL"
from urllib.parse import urlparse
import sys
u = urlparse(sys.argv[1])
print(u.port or (8443 if u.scheme == "https" else 8123))
PY
)"

# Prefer native protocol when talking to a local server started on 9000.
NATIVE_PORT=9000
if [[ "$HOST" == "127.0.0.1" || "$HOST" == "localhost" ]]; then
  echo "Applying schema and seed to ${HOST}:${NATIVE_PORT} as ${CLICKHOUSE_USERNAME}"
  clickhouse client \
    --host "$HOST" \
    --port "$NATIVE_PORT" \
    --user "$CLICKHOUSE_USERNAME" \
    --password "$CLICKHOUSE_PASSWORD" \
    --multiquery < db/schema.sql
  clickhouse client \
    --host "$HOST" \
    --port "$NATIVE_PORT" \
    --user "$CLICKHOUSE_USERNAME" \
    --password "$CLICKHOUSE_PASSWORD" \
    --multiquery < db/seed.sql
  clickhouse client \
    --host "$HOST" \
    --port "$NATIVE_PORT" \
    --user "$CLICKHOUSE_USERNAME" \
    --password "$CLICKHOUSE_PASSWORD" \
    --queries-file db/smoke.sql
else
  echo "Applying schema and seed via HTTP ${CLICKHOUSE_URL}"
  AUTH_USER="$CLICKHOUSE_USERNAME"
  AUTH_PASS="$CLICKHOUSE_PASSWORD"
  curl -fsS "${CLICKHOUSE_URL%/}/?user=${AUTH_USER}&password=${AUTH_PASS}&database=default&multiquery=1" \
    --data-binary @db/schema.sql >/dev/null
  curl -fsS "${CLICKHOUSE_URL%/}/?user=${AUTH_USER}&password=${AUTH_PASS}&database=default&multiquery=1" \
    --data-binary @db/seed.sql >/dev/null
  curl -fsS "${CLICKHOUSE_URL%/}/?user=${AUTH_USER}&password=${AUTH_PASS}&database=deploylens&multiquery=1" \
    --data-binary @db/smoke.sql
fi

echo "ClickHouse deploylens database is ready."

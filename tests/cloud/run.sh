#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
container="stamp-wallet-db-test-${RANDOM}-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run --rm -d --network none --tmpfs /var/lib/postgresql/data:rw,size=256m --name "$container" -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine >/dev/null
for attempt in $(seq 1 50); do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 0.2
done
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres < tests/cloud/bootstrap.sql >/dev/null
for migration in supabase/migrations/*.sql; do
  docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres < "$migration" >/dev/null
done
STAMP_TEST_CONTAINER="$container" python3 tests/cloud/test_backend.py

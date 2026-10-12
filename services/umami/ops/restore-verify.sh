#!/usr/bin/env bash
# Restore a dump into a throwaway PostgreSQL container with no network and tmpfs storage; never touches live Umami or Cloud.
set -euo pipefail
DUMP="${1:?dump path}"
IMG="postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea"
N="umami-restore-verify-$$"
sha256sum -c "$DUMP.sha256" >/dev/null
trap 'docker rm -f "$N" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$N" --network none --read-only --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --cap-add SETGID --cap-add SETUID \
  --security-opt no-new-privileges:true --memory 512m --tmpfs /tmp --tmpfs /var/run/postgresql --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=verify "$IMG" >/dev/null
for _ in $(seq 1 30); do docker exec "$N" pg_isready -U postgres -d verify >/dev/null 2>&1 && break; sleep 2; done
docker exec -i "$N" pg_restore -U postgres -d verify --no-owner --exit-on-error < "$DUMP"
docker exec "$N" psql -U postgres -d verify -Atc "select 'tables='||count(*) from information_schema.tables where table_schema='public'; select 'users='||count(*) from \"user\"; select 'migrations='||count(*) from _prisma_migrations;"
echo RESTORE_VERIFY_OK

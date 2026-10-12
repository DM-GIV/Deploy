#!/usr/bin/env bash
# Consistent pg_dump of the dedicated Umami DB only. Output stays under the Umami isolated tree (NOT /srv/auction-backups).
set -euo pipefail
U="${UMAMI_ROOT:-/home/deploy/torgatlas-ops/isolated/umami}"
DB_CT="${UMAMI_DB_CONTAINER:-torgatlas-umami-umami-db-1}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
umask 077
mkdir -p "$U/backups"
OUT="$U/backups/umami-$TS.dump"
docker exec "$DB_CT" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$OUT"
sha256sum "$OUT" > "$OUT.sha256"
printf '{"file":"%s","bytes":%s,"utc":"%s"}\n' "$(basename "$OUT")" "$(stat -c %s "$OUT")" "$TS" > "$U/backup-manifests/umami-$TS.json"
echo "$OUT"

#!/bin/bash
# Approval-package helper for the dedicated Core public-search container. Subcommands:
#   preflight   READ-ONLY checks (default). Changes nothing.
#   up          create/start the container (needs the approvals listed in README.md)
#   verify      health + token + path checks against the running container
#   down        stop and remove ONLY this container (immediate disconnect; image and role stay)
# It never touches aa-data004-api-1, the shared Docker networks' configuration, DNS or Core secrets.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
OPS=${TA_OPS:-/home/deploy/torgatlas-ops}
ENV_FILE=${CORE_PS_ENV_FILE:-$OPS/core-public-search.env}
export CORE_PS_IMAGE=${CORE_PS_IMAGE:-auction-data004:torgatlas-public-search-c13524f}
export CORE_PS_ENV_FILE=$ENV_FILE
compose() { docker compose -p torgatlas-core-ps -f "$HERE/compose.yml" "$@"; }
ok() { printf 'OK    %s\n' "$*"; }; bad() { printf 'FAIL  %s\n' "$*"; FAILS=$((FAILS+1)); }
FAILS=0
case "${1:-preflight}" in
preflight)
  docker image inspect "$CORE_PS_IMAGE" >/dev/null 2>&1 && ok "image $CORE_PS_IMAGE present" || bad "image $CORE_PS_IMAGE missing (build: cd <core worktree>/app/backend && docker build -f Dockerfile.data004 -t $CORE_PS_IMAGE .)"
  docker network inspect aa-data004_default >/dev/null 2>&1 && ok "network aa-data004_default exists (not modified)" || bad "network aa-data004_default missing"
  [ "$(docker network inspect torgatlas-ai_ta_ai_internal --format '{{.Internal}}' 2>/dev/null)" = true ] && ok "ai internal network is internal=true" || bad "ai internal network missing or not internal"
  if [ -f "$ENV_FILE" ]; then
    [ "$(stat -c %a "$ENV_FILE")" = 600 ] && ok "env file mode 600" || bad "env file must be mode 600"
    for k in DATABASE_URL PUBLIC_SEARCH_TOKEN_SHA256; do grep -q "^$k=." "$ENV_FILE" && ok "env has $k (value not shown)" || bad "env lacks $k"; done
    grep -q '^DATABASE_URL=postgresql://torgatlas_public_search:' "$ENV_FILE" && ok "DATABASE_URL uses the SELECT-only role" || bad "DATABASE_URL must use role torgatlas_public_search"
  else bad "env file $ENV_FILE not created yet"; fi
  docker inspect aa-data004-api-1 --format '{{.State.Status}} image={{.Config.Image}}' | sed 's/^/INFO  Core API (will NOT be recreated): /'
  [ -n "$(docker ps -q -f name=torgatlas-ai-core-search)" ] && ok "container already running" || echo "INFO  container not running (expected before approval)"
  awk '/MemAvailable/{printf "INFO  MemAvailable %d MB\n",$2/1024}' /proc/meminfo; echo "INFO  load: $(cut -d' ' -f1-3 /proc/loadavg)"
  echo "RESULT preflight fails=$FAILS"; exit $((FAILS>0)) ;;
up) compose up -d --no-build ;;
down) compose down ;;
verify)
  c=torgatlas-ai-core-search
  docker exec "$c" python -c "import urllib.request;print('health',urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=4).status)"
  docker exec "$c" python -c "
import urllib.request,urllib.error
for p in ('/docs','/openapi.json','/admin','/api/v1/lots'):
    try: print(p, urllib.request.urlopen('http://127.0.0.1:8000'+p,timeout=4).status)
    except urllib.error.HTTPError as e: print(p, e.code)" ;;
*) echo "usage: $0 [preflight|up|verify|down]"; exit 2 ;;
esac

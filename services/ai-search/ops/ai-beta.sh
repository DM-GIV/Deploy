#!/bin/bash
# TorgAtlas AI-search beta control. Subcommands: stage | deploy | enable | disable | rollback
#   stage    non-mutating: builds candidate nginx config in a temp dir and runs `nginx -t` in a throwaway container
#   deploy   installs containers (feature flags OFF) + nginx include; auto-rollback on any error/EXIT
#   enable   sets AI_LOT_SEARCH_ENABLED=true ONLY; security/legal flags must already be true by owner decision
#   disable  kill switch: all flags false, ai-search recreated (nginx untouched)
#   rollback removes nginx include/zone, restores locations.inc, stops the containers
set -Eeuo pipefail
OPS=${TA_OPS:-/home/deploy/torgatlas-ops}
REPO=${TA_REPO:-/home/deploy/torgatlas-site-master-20261014}
SVC="$REPO/services/ai-search"
NGX="$OPS/nginx/torgatlas.d"
LOCATIONS="$NGX/torgatlas-locations.inc"
AI_INC="$NGX/torgatlas-ai.inc"
AI_ZONE="$NGX/30-torgatlas-ai-zone.conf"
ENV_FILE="$OPS/ai-search.env"
PROXY=aa-data004-https-proxy
LINE='include /etc/nginx/torgatlas.d/torgatlas-ai.inc;'
LEAD='include /etc/nginx/torgatlas.d/torgatlas-lead.inc;'
compose() { AI_SEARCH_ENV_FILE="$ENV_FILE" docker compose -p torgatlas-ai -f "$SVC/compose.yml" "$@"; }

make_locations() { # $1 = source file, minimal diff: one include line after the lead include
  grep -qF "$LINE" "$1" && { cat "$1"; return; }
  grep -qF "$LEAD" "$1" || { echo "lead include anchor missing" >&2; return 1; }
  awk -v lead="$LEAD" -v add="$LINE" '{print} index($0,lead){print add}' "$1"
}

nginx_test_staged() { # throwaway container, same image and mounts as the shared proxy, no network
  local st img; st=$(mktemp -d); trap 'rm -rf "$st"' RETURN
  cp "$NGX"/* "$st"/
  install -m 644 "$SVC/nginx/torgatlas-ai.inc" "$st/torgatlas-ai.inc"
  install -m 644 "$SVC/nginx/30-torgatlas-ai-zone.conf" "$st/30-torgatlas-ai-zone.conf"
  make_locations "$LOCATIONS" > "$st/torgatlas-locations.inc"
  img=$(docker inspect "$PROXY" --format '{{.Config.Image}}')
  diff -u "$LOCATIONS" "$st/torgatlas-locations.inc" || true
  docker run --rm --network none --read-only --tmpfs /tmp --tmpfs /var/cache/nginx --tmpfs /run \
    -v /home/deploy/aa-cloud-ui-001-worktree/https/letsencrypt:/etc/letsencrypt:ro \
    -v /home/deploy/aa-cloud-ui-001-worktree/https/nginx/conf.d:/etc/nginx/conf.d:ro \
    -v "$OPS/nginx/nginx.conf":/etc/nginx/nginx.conf:ro -v "$st":/etc/nginx/torgatlas.d:ro "$img" nginx -t
}

set_flags() { # $1=search $2=security $3=legal
  umask 077
  printf 'AI_LOT_SEARCH_ENABLED=%s\nAI_LOT_SECURITY_APPROVED=%s\nAI_LOT_LEGAL_APPROVED=%s\n' "$1" "$2" "$3" > "$ENV_FILE.new"
  mv "$ENV_FILE.new" "$ENV_FILE"
}

do_rollback() {
  set +e
  if [ -f "$ROLLBACK/torgatlas-locations.inc" ]; then cp "$ROLLBACK/torgatlas-locations.inc" "$LOCATIONS"; fi
  rm -f "$AI_INC" "$AI_ZONE"
  docker exec "$PROXY" nginx -t >/dev/null 2>&1 && docker exec "$PROXY" nginx -s reload >/dev/null 2>&1
  compose down >/dev/null 2>&1
  return 0
}

case "${1:-}" in
stage) nginx_test_staged ;;
deploy)
  ROLLBACK="$OPS/rollback-ai-$(date -u +%Y%m%dT%H%M%SZ)"; OK=0
  test ! -e "$AI_INC" -a ! -e "$AI_ZONE"
  nginx_test_staged >/dev/null
  mkdir -m 700 "$ROLLBACK"; cp "$LOCATIONS" "$ROLLBACK/torgatlas-locations.inc"
  trap '[ "$OK" = 1 ] || { echo "deploy failed -> rollback" >&2; do_rollback; }' EXIT
  set_flags false false false
  compose up -d --build
  for i in $(seq 1 15); do
    curl --noproxy '*' -fsS --max-time 3 http://127.0.0.1:18082/health >"$ROLLBACK/health.json" && break
    [ "$i" = 15 ] && exit 21; sleep 1
  done
  install -m 644 "$SVC/nginx/30-torgatlas-ai-zone.conf" "$AI_ZONE"
  install -m 644 "$SVC/nginx/torgatlas-ai.inc" "$AI_INC"
  make_locations "$ROLLBACK/torgatlas-locations.inc" > "$LOCATIONS.new" && mv "$LOCATIONS.new" "$LOCATIONS"
  docker exec "$PROXY" nginx -t
  docker exec "$PROXY" nginx -s reload
  OK=1; echo "deployed with feature flags OFF; rollback dir: $ROLLBACK" ;;
enable)  grep -q '^AI_LOT_SECURITY_APPROVED=true$' "$ENV_FILE" && grep -q '^AI_LOT_LEGAL_APPROVED=true$' "$ENV_FILE" \
           || { echo "security/legal flags are not true; refusing" >&2; exit 30; }
         set_flags true true true; compose up -d --force-recreate --no-deps ai-search ;;
disable) set_flags false false false; compose up -d --force-recreate --no-deps ai-search ;;
rollback) ROLLBACK=${2:-/nonexistent}; do_rollback ;;
*) echo "usage: $0 stage|deploy|enable|disable|rollback <dir>" >&2; exit 2 ;;
esac

#!/bin/bash
# TorgAtlas AI-search beta control.
#   stage    non-mutating: candidate nginx config -> `nginx -t` in a throwaway container (same image/mounts as the shared proxy)
#   up       build+start the two isolated containers (project torgatlas-ai) with ALL flags OFF; verifies health; rollback on failure
#   verify   non-mutating: the REAL proxy container must reach the edge, the port must be loopback-only, snapshot of other vhosts
#   route    staged nginx -t -> install include+zone -> reload -> post checks; automatic rollback of the route on any failure/EXIT
#   status   containers, flag names/values, route state
#   enable   sets all three flags true; REFUSES unless a PASS security review and a recorded owner decision exist in git
#   disable  KILL SWITCH: all flags false, ai-search recreated (nginx untouched, ~5 s)
#   rollback removes route + stops containers (optional arg: rollback dir)
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
SITE=torgatlas.ru
LOCK="$OPS/.ai-beta.lock"
compose() { AI_SEARCH_ENV_FILE="$ENV_FILE" docker compose -p torgatlas-ai -f "$SVC/compose.yml" "$@"; }
log() { printf '[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
exec 9>"$LOCK"; flock -n 9 || { echo "another ai-beta.sh run is active" >&2; exit 3; }

make_locations() { # $1 = source file; minimal diff: one include line after the lead include
  grep -qF "$LINE" "$1" && { cat "$1"; return; }
  grep -qF "$LEAD" "$1" || { echo "lead include anchor missing" >&2; return 1; }
  awk -v lead="$LEAD" -v add="$LINE" '{print} index($0,lead){print add}' "$1"
}

nginx_test_staged() {
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
    -v "$OPS/nginx/nginx.conf":/etc/nginx/nginx.conf:ro -v "$st":/etc/nginx/torgatlas.d:ro "$img" nginx -t 2>&1 | tail -2
}

set_flags() { # $1=search $2=security $3=legal
  ( umask 077; printf 'AI_LOT_SEARCH_ENABLED=%s\nAI_LOT_SECURITY_APPROVED=%s\nAI_LOT_LEGAL_APPROVED=%s\n' "$1" "$2" "$3" > "$ENV_FILE.new" )
  mv "$ENV_FILE.new" "$ENV_FILE"
}

site_get() { # path [method] [outfile]
  curl --noproxy '*' -sS -m 10 -o "${3:-/dev/null}" -w '%{http_code}' --resolve "$SITE:443:127.0.0.1" ${2:+-X "$2"} -H "Origin: https://$SITE" "https://$SITE$1"
}
snapshot() { # status + body hash of unrelated surfaces: main site, privacy, lead, umami, default (cloud) vhost
  local tmp; tmp=$(mktemp)
  for p in / /privacy/ /api/lead-config /ta/s.js; do printf '%s %s ' "$p" "$(site_get "$p" GET "$tmp")"; sha256sum < "$tmp" | cut -c1-12; done
  printf 'default-vhost %s ' "$(curl --noproxy '*' -sk -m 10 -o "$tmp" -w '%{http_code}' -H 'Host: other.invalid' https://127.0.0.1/)"; sha256sum < "$tmp" | cut -c1-12
  rm -f "$tmp"
}

verify_edge() { # the REAL proxy container must reach the edge; the port must not be public
  local h pub
  h=$(docker exec "$PROXY" wget -q -T 4 -O - http://127.0.0.1:18082/health) || { echo "proxy container cannot reach edge" >&2; return 1; }
  echo "proxy container -> edge /health: $h"
  echo "proxy container -> edge /api/ai-lot-search: $(docker exec "$PROXY" wget -q -T 4 -O - http://127.0.0.1:18082/api/ai-lot-search | head -c 120)"
  ss -ltn | grep -E ':18082 ' | grep -q '127.0.0.1:18082' || { echo "edge port is not on loopback" >&2; return 1; }
  if ss -ltn | grep -E ':18082 ' | grep -qE '0\.0\.0\.0:18082|\*:18082|\[::\]:18082'; then echo "edge port exposed on wildcard" >&2; return 1; fi
  pub=$(ip -4 route get 1.1.1.1 | sed -n 's/.* src \([0-9.]*\).*/\1/p')
  if curl --noproxy '*' -s -m 3 -o /dev/null "http://$pub:18082/health"; then echo "edge reachable on public address $pub" >&2; return 1; fi
  echo "public address $pub:18082 closed: OK"
}

do_rollback() {
  set +e
  if [ -n "${ROLLBACK:-}" ] && [ -f "$ROLLBACK/torgatlas-locations.inc" ]; then
    cp "$ROLLBACK/torgatlas-locations.inc" "$LOCATIONS.rb" && mv "$LOCATIONS.rb" "$LOCATIONS"
  fi
  rm -f "$AI_INC" "$AI_ZONE"
  docker exec "$PROXY" nginx -t >/dev/null 2>&1 && docker exec "$PROXY" nginx -s reload >/dev/null 2>&1
  [ "${KEEP_CONTAINERS:-0}" = 1 ] || compose down >/dev/null 2>&1
  return 0
}

cmd=${1:-}
case "$cmd" in
stage) nginx_test_staged ;;
up)
  OK=0
  trap '[ "$OK" = 1 ] || { echo "up failed -> containers removed" >&2; compose down >/dev/null 2>&1 || true; }' EXIT
  [ -f "$ENV_FILE" ] || set_flags false false false
  compose up -d --build
  for i in $(seq 1 20); do curl --noproxy '*' -fsS --max-time 3 http://127.0.0.1:18082/health && break; [ "$i" = 20 ] && exit 21; sleep 1; done; echo
  OK=1; log "containers up" ;;
verify) verify_edge; snapshot ;;
route)
  ROLLBACK="$OPS/rollback-ai-$(date -u +%Y%m%dT%H%M%SZ)"; OK=0; KEEP_CONTAINERS=1
  test ! -e "$AI_INC" -a ! -e "$AI_ZONE"
  verify_edge
  nginx_test_staged
  mkdir -m 700 "$ROLLBACK"; cp "$LOCATIONS" "$ROLLBACK/torgatlas-locations.inc"; ln -sfn "$ROLLBACK" "$OPS/rollback-ai-latest"
  snapshot > "$ROLLBACK/snapshot.before"
  trap '[ "$OK" = 1 ] || { echo "route failed -> rollback" >&2; do_rollback; }' EXIT
  install -m 644 "$SVC/nginx/30-torgatlas-ai-zone.conf" "$AI_ZONE"
  install -m 644 "$SVC/nginx/torgatlas-ai.inc" "$AI_INC"
  make_locations "$ROLLBACK/torgatlas-locations.inc" > "$LOCATIONS.new" && mv "$LOCATIONS.new" "$LOCATIONS"
  docker exec "$PROXY" nginx -t
  docker exec "$PROXY" nginx -s reload
  sleep 2
  snapshot > "$ROLLBACK/snapshot.after"
  diff "$ROLLBACK/snapshot.before" "$ROLLBACK/snapshot.after" && log "unrelated surfaces identical before/after reload"
  code=$(site_get /api/ai-lot-search GET "$ROLLBACK/api-get.json"); [ "$code" = 200 ] && grep -q '"enabled"' "$ROLLBACK/api-get.json"
  echo "public GET /api/ai-lot-search -> $code $(head -c 100 "$ROLLBACK/api-get.json")"
  OK=1; log "route installed; rollback dir $ROLLBACK" ;;
status)
  compose ps --format '{{.Name}} {{.Status}}' || true
  grep -E '^AI_LOT' "$ENV_FILE" 2>/dev/null | tr '\n' ' '; echo
  [ -e "$AI_INC" ] && echo "route: installed" || echo "route: absent"
  echo "public GET: $(site_get /api/ai-lot-search GET /dev/stdout | head -c 200)" ;;
enable)
  grep -q '^REVIEW_RESULT: PASS' "$REPO/docs/torgatlas-web-program/12_AI_SECURITY_REVIEW.md" || { echo "no PASS security review recorded" >&2; exit 30; }
  grep -q '^OWNER_DECISION_RECORDED: YES' "$REPO/docs/torgatlas-web-program/13_AI_LEGAL_CHECKLIST.md" || { echo "no owner legal decision recorded" >&2; exit 31; }
  [ -e "$AI_INC" ] || { echo "route not installed" >&2; exit 32; }
  set_flags true true true; compose up -d --force-recreate --no-deps ai-search; log "ENABLED" ;;
disable) set_flags false false false; compose up -d --force-recreate --no-deps ai-search; log "DISABLED (kill switch)" ;;
rollback) ROLLBACK=${2:-$(readlink -f "$OPS/rollback-ai-latest" 2>/dev/null || true)}; do_rollback; log "route removed, containers stopped" ;;
*) echo "usage: $0 stage|up|verify|route|status|enable|disable|rollback [dir]" >&2; exit 2 ;;
esac

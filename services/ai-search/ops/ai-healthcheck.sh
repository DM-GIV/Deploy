#!/bin/bash
# Autonomous health probe for the TorgAtlas AI beta. No Claude session required; logs contain statuses only (no queries, no lot text).
#   ai-healthcheck.sh            one probe, appends a JSON line to $OPS/ai-health.log, exit 0 = healthy, 1 = unhealthy
#   ai-healthcheck.sh --guard    same, plus: after 3 consecutive unhealthy probes run `ai-beta.sh disable` (kill switch) once
# Suggested schedule (every 5 minutes): */5 * * * * /home/deploy/torgatlas-site-master-20261014/services/ai-search/ops/ai-healthcheck.sh --guard
set -uo pipefail
OPS=${TA_OPS:-/home/deploy/torgatlas-ops}
REPO=${TA_REPO:-/home/deploy/torgatlas-site-master-20261014}
LOG="$OPS/ai-health.log"; STATE="$OPS/.ai-health.fails"
SITE=torgatlas.ru
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
get() { curl --noproxy '*' -sS -m 8 -o "${2:-/dev/null}" -w '%{http_code}' --resolve "$SITE:443:127.0.0.1" "https://$SITE$1" 2>/dev/null || echo 000; }

health_state() { docker inspect -f '{{.State.Health.Status}}' "$1" 2>/dev/null || echo missing; }
search_h=$(health_state torgatlas-ai-search); edge_h=$(health_state torgatlas-ai-edge)
tmp=$(mktemp); api=$(get /api/ai-lot-search "$tmp")
enabled=$(python3 -c "import json,sys;print(str(json.load(open('$tmp')).get('enabled')).lower())" 2>/dev/null || echo unknown); rm -f "$tmp"
home=$(get /); lead=$(get /api/lead-config); umami=$(get /ta/s.js)
mem=$(docker stats --no-stream --format '{{.MemPerc}}' torgatlas-ai-search 2>/dev/null | tr -d '%' || echo 0)

ok=1
[ "$search_h" = healthy ] && [ "$edge_h" = healthy ] || ok=0
[ "$api" = 200 ] && [ "$home" = 200 ] && [ "$lead" = 200 ] && [ "$umami" = 200 ] || ok=0
printf '{"ts":"%s","search":"%s","edge":"%s","api":%s,"enabled":"%s","home":%s,"lead":%s,"umami":%s,"mem_pct":"%s","ok":%s}\n' \
  "$now" "$search_h" "$edge_h" "$api" "$enabled" "$home" "$lead" "$umami" "${mem:-0}" "$ok" >> "$LOG"

if [ "$ok" = 1 ]; then echo 0 > "$STATE"; exit 0; fi
fails=$(( $(cat "$STATE" 2>/dev/null || echo 0) + 1 )); echo "$fails" > "$STATE"
if [ "${1:-}" = "--guard" ] && [ "$fails" -eq 3 ] && [ "$enabled" = true ]; then
  printf '{"ts":"%s","action":"auto-disable after 3 consecutive unhealthy probes"}\n' "$now" >> "$LOG"
  "$REPO/services/ai-search/ops/ai-beta.sh" disable >> "$LOG" 2>&1
fi
exit 1

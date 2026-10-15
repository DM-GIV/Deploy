#!/bin/bash
# Autonomous health probe for the TorgAtlas AI beta. No Claude session required.
# Logs contain statuses only (never queries or lot text); log and state files are mode 600.
#   ai-healthcheck.sh            one probe: exit 0 healthy or in grace period, 1 confirmed unhealthy
#   ai-healthcheck.sh --guard    same, plus: after 3 consecutive CONFIRMED AI failures run `ai-beta.sh disable` (kill switch) once
# Schedule (every 5 minutes, user deploy): */5 * * * * .../ai-healthcheck.sh --guard
#
# Failure semantics:
#   grace      a container started less than GRACE_S ago and still reports "starting" => NOT a failure (normal restart/redeploy)
#   suspect    any AI check fails (container not healthy after grace, API status != 200, memory > 90%)
#   confirmed  the failure is still present after CONFIRM_TRIES re-probes CONFIRM_GAP_S seconds apart; only confirmed failures are counted
#   site-only  home/lead/umami failures are logged (site_ok=0) but never trigger the AI kill switch: disabling AI cannot repair them
set -uo pipefail
umask 077
OPS=${TA_OPS:-/home/deploy/torgatlas-ops}
REPO=${TA_REPO:-/home/deploy/torgatlas-site-master-20261014}
LOG="$OPS/ai-health.log"; STATE="$OPS/.ai-health.fails"
SITE=torgatlas.ru
GRACE_S=${GRACE_S:-150}; CONFIRM_TRIES=${CONFIRM_TRIES:-2}; CONFIRM_GAP_S=${CONFIRM_GAP_S:-20}; FAILS_TO_DISABLE=${FAILS_TO_DISABLE:-3}
LOG_MAX_LINES=${LOG_MAX_LINES:-4000}
exec 7>"$OPS/.ai-health.lock"; flock -n 7 || exit 0   # a previous probe (with confirmation waits) is still running

get() { curl --noproxy '*' -sS -m 8 -o "${2:-/dev/null}" -w '%{http_code}' --resolve "$SITE:443:127.0.0.1" "https://$SITE$1" 2>/dev/null || echo 000; }
age_s() { # seconds since container start; 999999 if unknown
  local s; s=$(docker inspect -f '{{.State.StartedAt}}' "$1" 2>/dev/null) || { echo 999999; return; }
  local t; t=$(date -d "$s" +%s 2>/dev/null) || { echo 999999; return; }
  echo $(( $(date +%s) - t ))
}
cstate() { # container -> healthy | grace | unhealthy | missing
  local h; h=$(docker inspect -f '{{if .State.Running}}{{.State.Health.Status}}{{else}}stopped{{end}}' "$1" 2>/dev/null) || { echo missing; return; }
  case "$h" in
    healthy) echo healthy ;;
    starting) [ "$(age_s "$1")" -lt "$GRACE_S" ] && echo grace || echo unhealthy ;;
    *) [ "$(age_s "$1")" -lt "$GRACE_S" ] && echo grace || echo unhealthy ;;   # just (re)created and not yet reporting
  esac
}

probe() { # sets: S_SEARCH S_EDGE S_CORE CORE_MODE API ENABLED HOME LEAD UMAMI MEM AI_OK SITE_OK GRACE
  S_SEARCH=$(cstate torgatlas-ai-search); S_EDGE=$(cstate torgatlas-ai-edge)
  local tmp; tmp=$(mktemp); API=$(get /api/ai-lot-search "$tmp")
  ENABLED=$(python3 -c "import json;print(str(json.load(open('$tmp')).get('enabled')).lower())" 2>/dev/null || echo unknown)
  # Core search container (informational: logged, never counted toward the kill switch - disabling AI cannot repair Core, and search is fail-closed anyway)
  CORE_MODE=$(python3 -c "import json;print(json.load(open('$tmp')).get('mode','unknown'))" 2>/dev/null || echo unknown)
  S_CORE=$(cstate torgatlas-ai-core-search); rm -f "$tmp"
  HOME_C=$(get /); LEAD=$(get /api/lead-config); UMAMI=$(get /ta/s.js)
  MEM=$(docker stats --no-stream --format '{{.MemPerc}}' torgatlas-ai-search 2>/dev/null | tr -d '%'); MEM=${MEM:-0}
  GRACE=0; { [ "$S_SEARCH" = grace ] || [ "$S_EDGE" = grace ]; } && GRACE=1
  AI_OK=1
  [ "$S_SEARCH" = healthy ] || [ "$S_SEARCH" = grace ] || AI_OK=0
  [ "$S_EDGE" = healthy ] || [ "$S_EDGE" = grace ] || AI_OK=0
  # API/memory are only judged when neither container is in its grace window (a restarting container may legitimately refuse requests)
  if [ "$GRACE" = 0 ]; then
    [ "$API" = 200 ] || AI_OK=0
    awk -v m="$MEM" 'BEGIN{exit !(m+0>90)}' && AI_OK=0
  fi
  SITE_OK=1; [ "$HOME_C" = 200 ] && [ "$LEAD" = 200 ] && [ "$UMAMI" = 200 ] || SITE_OK=0
}
logline() { # extra
  printf '{"ts":"%s","search":"%s","edge":"%s","api":%s,"enabled":"%s","home":%s,"lead":%s,"umami":%s,"mem_pct":"%s","grace":%s,"ai_ok":%s,"site_ok":%s,"core":"%s","core_c":"%s"%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$S_SEARCH" "$S_EDGE" "$API" "$ENABLED" "$HOME_C" "$LEAD" "$UMAMI" "$MEM" "$GRACE" "$AI_OK" "$SITE_OK" "$CORE_MODE" "$S_CORE" "${1:-}" >> "$LOG"
}
trim_log() { [ "$(wc -l < "$LOG" 2>/dev/null || echo 0)" -gt "$LOG_MAX_LINES" ] && { tail -n $((LOG_MAX_LINES/2)) "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; }; return 0; }
touch "$LOG" "$STATE"; chmod 600 "$LOG" "$STATE" 2>/dev/null

probe
if [ "$AI_OK" = 1 ]; then
  echo 0 > "$STATE"; logline ',"result":"ok"'; trim_log; [ "$SITE_OK" = 1 ]; exit $?
fi

# suspect: confirm by re-probing; a transient/restart condition clears itself
logline ',"result":"suspect"'
for i in $(seq 1 "$CONFIRM_TRIES"); do
  sleep "$CONFIRM_GAP_S"; probe
  if [ "$AI_OK" = 1 ]; then logline ',"result":"recovered_on_recheck"'; echo 0 > "$STATE"; trim_log; exit 0; fi
  logline ",\"result\":\"still_failing_recheck_$i\""
done

fails=$(( $(cat "$STATE" 2>/dev/null || echo 0) + 1 )); echo "$fails" > "$STATE"
logline ",\"result\":\"confirmed_failure\",\"consecutive\":$fails"
if [ "${1:-}" = "--guard" ] && [ "$fails" -eq "$FAILS_TO_DISABLE" ] && [ "$ENABLED" = true ]; then
  printf '{"ts":"%s","action":"auto-disable after %s consecutive confirmed failures"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$fails" >> "$LOG"
  "$REPO/services/ai-search/ops/ai-beta.sh" disable >> "$LOG" 2>&1
fi
trim_log; exit 1

#!/bin/bash
# Atomic static-release publication with preflight, a healthy baseline and automatic rollback.
#   publish-release.sh [--check-only] [SHA]    default SHA = HEAD (clean tree required unless the release dir already exists)
# Rules (a release that fails any of them is never left live):
#   1. BASELINE: before the switch every control route must already be HTTP 200 (local and external). Two identical 403 states never count as success.
#   2. PREFLIGHT: the new release is read AS THE NGINX WORKER USER inside the real proxy container: every ancestor directory traversable,
#      every file readable and byte-identical to the manifest sha256.
#   3. SWITCH: symlink replaced atomically (ln + mv -T).
#   4. VERIFY: every control route 200, never 403/5xx; static routes must equal the new release file hash; dynamic routes must equal the baseline.
#   5. Any failure after the switch => immediate rollback to the previous target and re-verification against the baseline.
set -Eeuo pipefail
OPS=${TA_OPS:-/home/deploy/torgatlas-ops}
REPO=${TA_REPO:-/home/deploy/torgatlas-site-master-20261014}
WWW="$OPS/www"; PROXY=aa-data004-https-proxy; SITE=torgatlas.ru
LOG="$OPS/release.log"
CHECK_ONLY=0; [ "${1:-}" = "--check-only" ] && { CHECK_ONLY=1; shift; }
SHA=${1:-$(git -C "$REPO" rev-parse HEAD)}
REL="$WWW/releases/$SHA"
exec 8>"$OPS/.publish.lock"; flock -n 8 || { echo "another publish is running" >&2; exit 3; }
log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$LOG"; }

# route -> kind: S = static file (hash must equal the release file), D = dynamic (hash must equal baseline), A = status only
ROUTES=(/ /ai-poisk-lotov/ /blog/ /privacy/ /poisk-imushchestva/ /pokupka-imushchestva/ /proverka-lota/ /primery-lotov/ /robots.txt /sitemap.xml /llms.txt /assets/ai-search.js /api/lead-config /ta/s.js /api/ai-lot-search)
kind_of() { case "$1" in /api/lead-config|/ta/s.js) echo D;; /api/ai-lot-search) echo A;; *) echo S;; esac; }
file_of() { local r=${1#/}; case "$r" in ""|*/) r="${r}index.html";; esac; echo "$r"; }
fetch() { # mode(local|external) route outfile -> prints status
  local res=(); [ "$1" = local ] && res=(--resolve "$SITE:443:127.0.0.1")
  curl --noproxy '*' -sS -m 12 -o "$3" -w '%{http_code}' "${res[@]}" "https://$SITE$2" 2>/dev/null || echo 000
}
hash_of() { sha256sum < "$1" | cut -c1-64; }

capture() { # outfile-prefix  -> lines "mode route status hash"
  local out=$1 tmp; tmp=$(mktemp); : > "$out"
  for mode in local external; do for r in "${ROUTES[@]}"; do
    code=$(fetch "$mode" "$r" "$tmp"); printf '%s %s %s %s\n' "$mode" "$r" "$code" "$(hash_of "$tmp")" >> "$out"
  done; done; rm -f "$tmp"
}
require_all_200() { # file label
  if awk '$3!=200{print "NOT 200: " $0; bad=1} END{exit bad}' "$1"; then return 0; fi
  log "FAIL $2: not every control route returned HTTP 200"; return 1
}

BASE=$(mktemp); AFTER=$(mktemp); trap 'rm -f "$BASE" "$AFTER"' EXIT
PREV=$(readlink "$WWW/current") ; [ -d "$WWW/$PREV" ] || { echo "previous release target missing: $PREV" >&2; exit 4; }
log "publish start sha=$SHA previous=$PREV check_only=$CHECK_ONLY"

capture "$BASE"; require_all_200 "$BASE" "BASELINE (current release must be healthy before any switch)" || exit 10

if [ ! -d "$REL" ]; then
  [ -z "$(git -C "$REPO" status --porcelain)" ] || { echo "dirty tree" >&2; exit 5; }
  [ "$(git -C "$REPO" rev-parse HEAD)" = "$SHA" ] || { echo "SHA is not HEAD; build only from HEAD" >&2; exit 5; }
  python3 "$REPO/scripts/build-static-release.py" --output "$REL" >/dev/null
fi
python3 - "$REL" "$SHA" <<'P' || exit 6
import json,sys
m=json.load(open(sys.argv[1]+'/release-manifest.json')); assert m['source_commit']==sys.argv[2],'manifest commit mismatch'
P

# --- PREFLIGHT as the nginx worker user, inside the real proxy container ---
INSIDE="/srv/torgatlas/releases/$SHA"
python3 -c "
import json,sys
for f in json.load(open('$REL/release-manifest.json'))['files']: print(f['sha256']+'  '+f['path'])
" > "$REL/../.$SHA.sums"
trap 'rm -f "$BASE" "$AFTER" "$WWW/releases/.$SHA.sums"' EXIT
docker exec -u nginx "$PROXY" sh -c "p=$INSIDE; while [ \"\$p\" != / ]; do [ -x \"\$p\" ] && [ -r \"\$p\" ] || { echo \"not traversable: \$p\"; exit 1; }; p=\$(dirname \$p); done" \
  || { log "FAIL preflight: ancestor directory not traversable by nginx user"; exit 11; }
docker exec -u nginx "$PROXY" sh -c "cd $INSIDE && find . -type d | while read d; do [ -x \"\$d\" ] && [ -r \"\$d\" ] || { echo \"dir not accessible: \$d\"; exit 1; }; done" \
  || { log "FAIL preflight: release subdirectory not accessible to nginx user"; exit 11; }
docker exec -i -u nginx "$PROXY" sh -c "cd $INSIDE && sha256sum -c -" < "$WWW/releases/.$SHA.sums" >/dev/null \
  || { log "FAIL preflight: a file is unreadable by nginx user or differs from the manifest"; exit 11; }
docker exec -u nginx "$PROXY" test -s "$INSIDE/index.html" || { log "FAIL preflight: index.html missing/empty"; exit 11; }
log "preflight OK (all dirs traversable and all files read+hash-verified as nginx user)"
[ "$CHECK_ONLY" = 1 ] && { log "check-only: not switching"; exit 0; }

# --- SWITCH + VERIFY + ROLLBACK ---
verify() { # compares AFTER to rules; returns 0/1
  capture "$AFTER"; require_all_200 "$AFTER" "post-switch" || return 1
  local ok=0 mode r code h k exp
  while read -r mode r code h; do
    k=$(kind_of "$r")
    if [ "$k" = S ]; then exp=$(hash_of "$WWW/releases/$1/$(file_of "$r")"); else exp=$(awk -v m="$mode" -v r="$r" '$1==m&&$2==r{print $4}' "$BASE"); fi
    [ "$k" = A ] && continue
    [ "$h" = "$exp" ] || { log "FAIL hash mismatch mode=$mode route=$r got=${h:0:12} expected=${exp:0:12}"; ok=1; }
  done < "$AFTER"
  return $ok
}
rollback() {
  log "ROLLBACK to $PREV"
  ln -sfn "$PREV" "$WWW/current.rb" && mv -T "$WWW/current.rb" "$WWW/current"
  capture "$AFTER"; if require_all_200 "$AFTER" "post-rollback"; then log "rollback verified: all control routes 200"; else log "CRITICAL: rollback did not restore HTTP 200 - manual action required"; fi
}
ln -sfn "releases/$SHA" "$WWW/current.new" && mv -T "$WWW/current.new" "$WWW/current"
sleep 1
if verify "$SHA"; then log "publish OK: current -> releases/$SHA (previous $PREV)"; else rollback; exit 12; fi

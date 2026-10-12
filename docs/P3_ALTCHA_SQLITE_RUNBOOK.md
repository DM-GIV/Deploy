# P3 direct leads — runbook (ALTCHA + SQLite first, SMTP optional)

Production layout (server `auction-core-v01`, user `deploy`; Cloud/Core, `/opt/auction-analytics`, Redis/PostgreSQL are never touched):

| Part | Path |
| --- | --- |
| Isolated contour | `/home/deploy/torgatlas-ops/isolated/lead-intake/{app,config,data,logs,backup-manifests}` (dirs 0700/0750; secrets/DB 0600) |
| SQLite DB | `/home/deploy/torgatlas-ops/isolated/lead-intake/data/leads.sqlite3` (container path `/data/leads.sqlite3`) |
| Env (secrets, 0600) | `isolated/lead-intake/config/lead.env`, template `services/lead-intake/env.example` |
| Container | `torgatlas-lead-intake`, image built from this repo, user = deploy uid, `127.0.0.1:18081` only |
| Site (static) | `/home/deploy/torgatlas-ops/www/releases/<sha>` ← `www/current` symlink |
| Nginx (site-owned) | `/home/deploy/torgatlas-ops/nginx/torgatlas.d/` (templates in `services/lead-intake/nginx/`) |

## Deploy (site-only, after review PASS and merge)
1. Preflight: `df -h /`, `uptime`, Cloud health (`curl --noproxy '*' -sI https://torgatlas.ru/` and Cloud routes 308/200/200/404), `docker ps` has no other writer, snapshot current `www/current` target and `nginx/torgatlas.d` into `rollback-p3-<date>/`.
2. Static: build release dir `www/releases/<merge sha>` (git archive of the merged commit, only site files), switch the `current` symlink. Includes `assets/vendor/altcha/*`.
3. Container: copy `services/lead-intake/{compose.yml,Dockerfile,...}` to `isolated/lead-intake/app`, `export LEAD_UID=$(id -u) LEAD_GID=$(id -g) LEAD_ENV_FILE=…/config/lead.env LEAD_DATA_HOST_DIR=…/data`, `docker compose build && up -d`. Secrets generated with `python3 -c "import secrets;print(secrets.token_urlsafe(48))"` straight into `lead.env` (never printed). Keep `DIRECT_LEADS_LEGAL_APPROVED=false` until the owner confirms the legal prerequisite; the service then answers `{"enabled":false}`.
4. Nginx: add `30-torgatlas-lead-zone.conf`, replace the two disabled stubs in `torgatlas-locations.inc` by `include …/torgatlas-lead.inc`, run `nginx -t` in the proxy container, then `nginx -s reload` only if it passes.
5. Verify (before/after): `/`, `/privacy/`, `/api/lead-config`, `/ta/s.js`, Cloud health.

## Mandatory checks at step 3
- `data/` must be mode 0700 and owned by deploy, otherwise the service stays not-ready (`enabled:false`, fail-closed).
- Set `LEAD_TRUSTED_PROXIES` in `lead.env` to the peer address the container really sees (Docker bridge gateway, e.g. `172.17.0.1`; check with `docker network inspect bridge`), then verify that two different `X-Real-IP` values get separate rate-limit buckets; otherwise all visitors share one limit.
- Never publish container port 8081 beyond `127.0.0.1`.
- Notification is at-most-once/best-effort: `leadctl.py stats` shows `notification:pending|sending|failed` counts so lost notifications are visible.

## Activation (owner decision)
Set `DIRECT_LEADS_LEGAL_APPROVED=true` in `lead.env`, `docker compose up -d`; run the production E2E below; only afterwards flip `DIRECT_LEADS_ENABLED = true` in `assets/analytics.js` (event `lead_direct_accepted`, no contact/message/URL) and update the last sentence of `/privacy/` ("Серверный приём заявок … выключенным") in a follow-up release.

## Production E2E (no real personal data)
Browser on https://torgatlas.ru → lot form → prepare enquiry → edit text to start with `TEST_E2E_`, contact `test-e2e@example.invalid`, tick consent, solve ALTCHA, submit → receipt shown. Then `leadctl.py list --all` shows exactly one row; repeat of the same UUID returns the same receipt; changed payload → 409; reused challenge for another UUID → 403; corrupted/expired challenge → 403. Remove only the marked test row: `leadctl.py cleanup-test <id> --execute`.

## Owner read path (no public endpoint)
```
cd /home/deploy/torgatlas-p3-altcha-sqlite-first-01   # or any checkout of services/lead-intake
python3 services/lead-intake/leadctl.py stats          # counts only — safe for reports
python3 services/lead-intake/leadctl.py list           # new leads WITH contacts — terminal only
python3 services/lead-intake/leadctl.py show <id>
python3 services/lead-intake/leadctl.py ack <id>       # mark reviewed (never deletes)
```
Default DB path is the production one; override with `--db`. Never paste `list/show` output into Linear, Git, Umami or logs.

## SMTP (optional)
Fill all of `SMTP_HOST, SMTP_PORT(465|587), SMTP_USER, SMTP_PASSWORD, SMTP_FROM, LEAD_EMAIL_TO` to enable; otherwise `notification_status=not_configured`. Sent after commit only; `sending` rows are never retried (ambiguous result → owner checks the mailbox).

## Backups / migrations
On first start with an older DB the service copies it (SQLite backup API) to `data/pre-migration-backups/leads-v<N>-<UTC>.sqlite3` (0600, never overwritten) before `ALTER TABLE`; real rows are never deleted. Regular backups of `data/leads.sqlite3` need a separately approved ops package. `retention.py` is dry-run only and MUST NOT be scheduled until a retention period is legally approved.

## Rollback (site-only; accepted leads are never deleted)
1. Restore the previous `nginx/torgatlas.d` snapshot (stubs → `{"enabled":false}` / POST 503), `nginx -t`, reload.
2. `ln -sfn` the saved previous release into `www/current`.
3. `docker compose stop torgatlas-lead-intake` (the data directory and DB stay). Cloud/PostgreSQL/Redis are never involved.

## Real-browser test (throwaway container)
```
docker run --rm --ipc=host --user 1000:1000 -e HOME=/tmp -e PYTHONDONTWRITEBYTECODE=1 -e PYTHONPATH=/pwlib \
  -v <dir with unpacked playwright 1.48 python wheels>:/pwlib:ro -v "$PWD":/work:ro \
  mcr.microsoft.com/playwright/python:v1.48.0-jammy python3 /work/tests/browser_e2e.py
```

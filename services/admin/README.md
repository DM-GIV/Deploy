# TorgAtlas admin (admin.torgatlas.ru)

Standalone, dependency-free (Python stdlib) admin service. First module: «Заявки». Reuses the existing lead-intake SQLite
(mounted **read-only**, schema untouched); processing state, notes, users, sessions, audit and the notification outbox live in a
separate `admin.sqlite3`. Status mapping: no overlay row → `new`; legacy `leadctl ack` → «В работе»; legacy `close` → «Завершена».
Setting «Завершена» in the panel does NOT set `closed_at` (that starts the 30-day destruction clock and needs a legal decision).

## Modules
Add with `register_module(key, title, path)` in `admin_app.py`; only registered modules appear in navigation (no placeholder pages).

## Tests (no network, no production data)
`python3 -I services/admin/tests/test_admin.py`

## Owner steps to go live (nothing below is done by the code agent)
1. DNS (Selectel): add ONE record `admin` A → the same address as `torgatlas.ru` (currently 91.105.197.46). Do not touch apex/www/app.
2. Certificate for `admin.torgatlas.ru` (HTTP-01 through `/var/www/acme` of the shared proxy, or DNS-01), placed in the proxy's letsencrypt dir.
3. `mkdir -p -m700 …/isolated/admin/{data,config}`; create `config/admin.env` (0600) from `env.example`.
4. `export ADMIN_UID=$(id -u) ADMIN_GID=$(id -g) ADMIN_ENV_FILE=… LEADS_DATA_HOST_DIR=…/lead-intake/data ADMIN_DATA_HOST_DIR=…/isolated/admin/data; docker compose up -d --build` in `services/admin`.
5. Interactive console: `python3 services/admin/adminctl.py --db …/admin/data/admin.sqlite3 create-user owner` (password hidden; TOTP key printed only to that terminal).
6. Telegram (owner action; the token goes only into admin.env, never into chat/Git; the chat id is not a secret but is kept there too): create bot via @BotFather, put `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` in `admin.env`, run `adminctl.py telegram-test`.
7. Copy `nginx/torgatlas-admin.conf` + `admin-proxy.inc` to `torgatlas-ops/nginx/torgatlas.d/`, `nginx -t` inside the proxy container, then reload.
8. Never list the subdomain in sitemap.xml (it is not in this repo's sitemap).

## Rollback
`docker compose down` in `services/admin`; remove the two nginx files and reload; lead-intake and its DB are not modified by this service.
Backup/restore check: `adminctl.py backup DIR --leads PATH`, `adminctl.py verify-backup FILE`.

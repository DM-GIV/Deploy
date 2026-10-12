# TorgAtlas self-hosted Umami (v3)

Собственная веб-аналитика сайта. Отдельная PostgreSQL только для Umami; ничего общего с Cloud DB/Redis/сетями.

- Образы (по digest): `ghcr.io/umami-software/umami` Umami 3.4.0 (`postgresql` build) и `postgres:16-alpine` (16.15). Обновление образа = новая проверка и новый digest.
- Production-каталог: `/home/deploy/torgatlas-ops/isolated/umami/{app,config,data,backups,backup-manifests,logs}`. Секреты — только `config/umami.env` (0600), шаблон `umami.env.example`.
- Запуск: `cd app && docker compose up -d`. Проверка: `docker compose config --quiet`, `/api/heartbeat`, `pg_isready` (healthcheck).
- Hardening: `read_only`, `cap_drop: ALL` (БД — минимум для chown/su), `no-new-privileges`, app только на `127.0.0.1:19120`, БД без порта в `internal`-сети, лимиты памяти/CPU/pids.
- Dashboard НЕ публикуется: доступ владельцу через SSH-туннель `ssh -L 19120:127.0.0.1:19120 deploy@<host>` → `http://127.0.0.1:19120`. Наружу через Nginx только `/ta/s.js` и `POST /ta/api/send` (`nginx/`).
- Backup/restore: `ops/backup.sh` (pg_dump -Fc в `backups/`, не в `/srv/auction-backups`), `ops/restore-verify.sh <dump>` (изолированный контейнер без сети).
- Трекер: `assets/analytics.js` — только после согласия, учитывает GPC/DNT, события из allowlist, URL без query/hash, без session replay.
- Provenance: реализация независима от локального коммита `ea996d1` (Windows worktree, не был доступен серверу).

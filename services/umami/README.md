# TorgAtlas self-hosted Umami (v3)

Собственная веб-аналитика сайта. Отдельная PostgreSQL только для Umami; ничего общего с Cloud DB/Redis/сетями.

- Образы (по digest): `ghcr.io/umami-software/umami` Umami 3.4.0 (`postgresql` build) и `postgres:16-alpine` (16.15). Обновление образа = новая проверка и новый digest.
- Production-каталог: `/home/deploy/torgatlas-ops/isolated/umami/{app,config,data,backups,backup-manifests,logs}`. Секреты — только `config/umami.env` (0600), шаблон `umami.env.example`.
- Запуск: `cd app && docker compose up -d`. Проверка: `docker compose config --quiet`, `/api/heartbeat`, `pg_isready` (healthcheck).
- Hardening: `read_only`, `cap_drop: ALL` (БД — минимум для chown/su), `no-new-privileges`, app только на `127.0.0.1:19120`, БД без порта в `internal`-сети, лимиты памяти/CPU/pids.
- Dashboard НЕ публикуется (DNS `stats.torgatlas.ru` отсутствует на 2026-10-12, менять DNS вне scope). Доступ владельцу: двойной клик по `owner/Open-TorgAtlasStats.cmd` (Windows; использует уже настроенный SSH-алиас `auction-core-v01` и ключ/агент, паролей не хранит) → туннель на `http://127.0.0.1:19120` → отдельный вход Umami. Вручную: `ssh -L 19120:127.0.0.1:19120 auction-core-v01`. Наружу через Nginx только `/ta/s.js` и `POST /ta/api/send` (`nginx/`).
- Backup/restore: `ops/backup.sh` (pg_dump -Fc в `backups/`, не в `/srv/auction-backups`), `ops/restore-verify.sh <dump>` (изолированный контейнер без сети).
- Трекер: `assets/analytics.js` — только после согласия, учитывает GPC/DNT, события из allowlist, URL без query/hash, без session replay.
- Provenance: реализация независима от локального коммита `ea996d1` (Windows worktree, не был доступен серверу).

## Контроль обращений (без CRM и без персональных данных)
- Umami измеряет только **клики** по email/Telegram/телефону (`funnel_contact_open`, `lead_handoff_opened`, разбивка `channel` из закрытого списка email|telegram|phone) у посетителей с согласием. Клик не равен полученной заявке.
- **Фактически полученные обращения** владелец вносит вручную: `python3 services/umami/ops/leads_report.py add --channel telegram --source lot_check` (журнал `/home/deploy/torgatlas-ops/ops/lead-ledger.csv`, 0600, только дата/канал/источник/статус).
- Сводка: `python3 services/umami/ops/leads_report.py report --days 30` — отдельно блоки A (переходы) и B (получено).

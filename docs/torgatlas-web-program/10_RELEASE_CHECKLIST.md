# Release candidate checklist — ТоргАтлас

Дата подготовки: 2026-10-14. Это план, а не разрешение на production deploy.

## Фактическая топология

- Git: `DM-GIV/Deploy`, release source — отдельно принятый merge commit.
- Static site: `/home/deploy/torgatlas-ops/www/releases/<sha>`; `www/current` переключается атомарной symlink.
- Nginx static root внутри proxy: `/srv/torgatlas/current`.
- На момент read-only проверки `www/current` указывал на `releases/ec487cf`.
- `/api/lead*` и `/ta/*` принадлежат отдельным site-owned контурам и не должны меняться при статическом выпуске.
- Общий `/api/*` возвращает 404. Поэтому AI-search на static-only выпуске остаётся fail-closed и не отправляет query.

## Candidate A — основной сайт, AI OFF

### Preflight / STOP

1. Есть явное разрешение владельца на выпуск, окно работ и назначенный исполнитель.
2. Принятый `<RC_SHA>` — commit в `main`, worktree чистый; `git diff --check` и весь test matrix PASS.
3. Достаточно места; нет другого писателя в site-owned ops; Cloud/Core/PostgreSQL/Redis не затрагиваются.
4. Сохранены: целевой путь `www/current`, manifest текущего release и копия site-owned nginx includes. Секреты, SQLite и visitor analytics в backup статического релиза не копируются.
5. STOP при несовпадении SHA/manifest, ошибке сборки, неизвестном изменении nginx, неготовом rollback или любом FAIL smoke.

### Reproducible payload

В чистом checkout принятого SHA:

```text
python3 scripts/generate-sitemap.py --check
python3 scripts/validate-public-site.py
python3 scripts/build-static-release.py --output /tmp/torgatlas-static-<RC_SHA>
```

Builder берёт только tracked static files, создаёт SHA-256 `release-manifest.json` и исключает `api/`, `lib/`, `services/`, `docs/`, `tests/`, `.env` и SQLite. Получившийся каталог сначала сравнивается с `<RC_SHA>`, затем уполномоченный исполнитель устанавливает его как новый неизменяемый `www/releases/<RC_SHA>`.

### Switch and smoke

1. Не менять lead/Umami includes. Проверить nginx config до reload; статическая смена symlink обычно не требует reload.
2. Переключить `www/current` только на полностью установленный release directory.
3. Проверить HTTPS/status/headers и содержимое: `/`, основные услуги, `/o-torgatlas/`, `/blog/`, три готовые статьи, `/privacy/`, `/privacy/consent/`, `robots.txt`, `sitemap.xml`, `llms.txt`, `404`, CSS/JS/images.
4. Проверить на 320 и desktop: меню, CTA, обе бесплатные карты, consent accept/decline, отсутствие Umami до согласия.
5. Проверить, что три `EDITORIAL_REVIEW_REQUIRED` статьи имеют `noindex` и отсутствуют в sitemap; AI page имеет `noindex`, GET API не разблокирует форму.
6. Проверить существующие `/api/lead-config`, `/api/lead`, `/ta/s.js` без реальных контактов и заявок; их состояние не должно измениться из-за static release.

### Rollback

При любом FAIL вернуть `www/current` на заранее записанный предыдущий release, повторить короткий smoke `/`, `/privacy/`, `/api/lead-config`, `/ta/s.js`. Новый каталог не удалять до разбора; реальные SQLite/analytics данные не откатывать и не удалять.

## Candidate B — AI service, отдельный HOLD

Git содержит минимальный `services/ai-search`, но он не развёрнут и не разрешён к включению.

До отдельного AI ops-пакета нельзя добавлять nginx include, запускать container или менять флаги. Будущий безопасный порядок:

1. Подтвердить production egress для фиксированных GIS/ЕФРСБ/МЭТС маршрутов без обхода proxy/WAF и получить хотя бы один датированный `PUBLIC_SOURCE_VERIFIED` E2E.
2. Проверить pinned base image/digest, build context и отсутствие секретов; создать отдельный env 0600 с тремя флагами `false`.
3. Развернуть только на `127.0.0.1:18082`, проверить health и `GET /api/ai-lot-search → enabled:false`.
4. Установить shared nginx rate/connection zones, exact route include, выполнить `nginx -t`; общий `/api/` deny сохранить.
5. Проверить SSRF/DNS/IP/redirect/time/size limits, SOURCE_BLOCKED, timeout, cache, concurrency, 2 requests/min/IP и CPU/RAM limits в фактической topology.
6. После отдельной legal/security/product приёмки и разрешения владельца включить все три `AI_LOT_*` flags; выполнить real-source E2E без персональных данных. Только затем рассматривать indexability AI page.

Rollback AI: вернуть exact nginx route к 404/fail-closed, проверить config, остановить только `torgatlas-ai-search`; static page и остальные site-owned services остаются без изменений.

## Текущий вердикт

- `SITE_RELEASE_READY`: **YES для Candidate A** по исходникам и локальному artifact smoke; требуется отдельное owner approval, production ещё не изменён.
- `AI_SEARCH_READY`: **NO** — profiles только MOCK_TESTED, live lots 0, production egress/service/nginx не проверены.
- Требуемое решение владельца: отдельно разрешить Candidate A. Candidate B остаётся HOLD.

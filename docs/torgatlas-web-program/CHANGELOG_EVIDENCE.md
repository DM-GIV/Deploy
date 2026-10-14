# Evidence changelog

## Wave 01 — 2026-10-14 (локально, не production)

- Создан отдельный worktree от подтверждённого `origin/main`.
- AI-search UI переведён в fail-closed режим: до `enabled:true` выполняется только GET статуса, пользовательский query не отправляется.
- Исправлены два устаревших ожидания тестов и performance-check для hash query CSS.
- Production не изменялся; runtime verification остаётся UNKNOWN из-за timeout из текущей среды.

## Wave 02 — 2026-10-14 (локально, не production)

- `content/public-pages.json` стал единственным реестром 13 indexable canonical URL.
- `scripts/generate-sitemap.py` генерирует sitemap; lastmod добавляется только когда дата явно подтверждена в registry.
- `scripts/validate-public-site.py` проверяет canonical, noindex, H1, sitemap XML/registry, robots, внутренние URL и anchors.
- Production не изменялся; результат относится к исходникам и локальным тестам.

## Wave 03 — 2026-10-14 (локально, не production)

- Локальный Chromium baseline главной на 390 px: hero и основные CTA видимы; браузерный screenshot сохранён только во временном `/tmp` и не является production-evidence.
- На главной добавлен видимый keyboard focus для ссылок, кнопок и раскрывающихся элементов; reduced-motion contract сохранён.
- Screenshot 320 px выявил обрезание menu items; меню на узком экране переведено на перенос строк. До/после сохранены локально в `evidence/wave-03/`.
- Возобновляемый Chromium harness создал `browser-matrix-v2.json`: 15 маршрутов × 7 ширин, без duplicate keys. AI search отмечен BLOCKED_STATIC_API только потому, что localhost static preview не содержит serverless endpoint.

## Wave 03B — 2026-10-14 (локально, не production)

- Добавлен `scripts/browser-interactive-audit.mjs`: изолированный local HTTP preview, Chromium и перехваты `/api/ai-lot-search` и `/ta/`; production-запросы, реальные контакты и заявки исключены.
- `interactive-matrix.json`: 11 PASS, 0 FAIL, 2 BLOCKED. Проверены keyboard navigation/CTA, обе локальные карты (validation → generation → change → regeneration → copy), AI disabled/success/empty/503/network failure и consent/Umami accept/decline/persistence.
- Исправлен AI network failure: технический текст `Failed to fetch` заменён безопасным сообщением о недоступности сервиса и ссылке на первоисточники.
- BLOCKED: у текущей mobile navigation нет открываемого состояния; ALTCHA challenge/pass/reject/replay требует изолированный TLS+SQLite E2E endpoint и не был подменён фиктивным PASS.

## Wave 04 — 2026-10-14 (локально, не production)

- Добавлена `/o-torgatlas/`: проверяемое описание метода, источников, редакционной политики и ограничений без биографии, цен, гарантий или отзывов.
- Добавлен экспериментальный `llms.txt` с правдивыми публичными ссылками; он не назван фактором ранжирования.
- `robots.txt` сохраняет доступность публичных страниц и исключает `/api/` только для model-training crawlers; OAI-SearchBot и ChatGPT-User явно не блокируются.
- Registry/sitemap расширены до 14 URL. Валидатор теперь проверяет JSON-LD syntax и ключевые обязательные типы, а также `llms.txt`.

## Wave 06 / GIS Mini — 2026-10-14 (локально, feature OFF)

- Внешний OpenAI web search удалён из публичного API; добавлен самостоятельный bounded GIS JSON profile.
- Исправлена семантика `biddEndTime`: поле не считается application deadline; `PUBLISHED` не считается открытым приёмом.
- Реализованы fixed listing/detail URLs, local query filtering, deduplication, provenance, coverage/cost metadata, cache, rate/concurrency budgets и DNS/IP-safe HTTPS transport without redirects.
- Fixture tests are MOCK_TESTED. Один live GIS GET завершился `SOURCE_NETWORK_ERROR`; текущих лотов не подтверждено, public flag остаётся OFF.

## Wave 06 / public source profiles — 2026-10-14 (локально, feature OFF)

- Добавлен ЕФРСБ Mini: две фиксированные list-страницы, bidding detail и первая связанная bankruptcy-message; документы не запрашиваются. TEST_ONLY fixtures подтверждают путь list → detail → real lot object.
- Добавлен МЭТС Mini: ограниченная серверная лента событий и до шести точных HTML-карточек; `/search`, `/catalog`, участие и документы исключены. TEST_ONLY fixtures подтверждают microdata/visible-field extraction.
- Общий HTTPS transport применяет source/path allowlist, DNS/public-IP pinning, запрет redirect, лимит типа/размера/таймаута. Детерминированный planner в режиме «Все» честно возвращает выбранный и непросмотренные источники.
- Live ЕФРСБ: HTTP 403 через обязательный локальный egress proxy; live МЭТС: timeout 4 s через тот же контур. Обход не выполнялся. РАД не подключён как discovery, потому что принятое исследование разрешает только exact detail по уже известному ID.
- `PUBLIC_SOURCE_VERIFIED=0`, live lots `0`, LLM calls/tokens `0`; публичные gates остаются OFF.

## Wave 06 / AI-search UX — 2026-10-14 (локально, feature OFF)

- Существующая `/ai-poisk-lotov/` дополнена примерами запросов, фактическим состоянием server research, source/time provenance, честным статусом приёма заявок, coverage note, empty/error states и переходом к карте проверки.
- Фиктивная анимация этапов не добавлялась: интерфейс сообщает только принятие запроса и итог API.
- `ai-browser-smoke.json`: 4/4 PASS на 320/390/768/1440 для disabled и enabled TEST_ONLY mock states; overflow/console/resource errors отсутствуют, focus/coverage/UNKNOWN/CTA проверены.
- Повторная общая интерактивная матрица: 11 PASS, 0 FAIL, 2 прежних ограничения; реальные заявки и production analytics не вызывались.

## Wave 06 / Selectel runtime and release preparation — 2026-10-14 (Git only)

- Подтверждена фактическая static topology: `www/current → releases/ec487cf`, отдельные lead/Umami includes, общий `/api/* → 404`. Production не изменялся.
- Добавлен минимальный `services/ai-search`: built-in Node HTTP server, fail-closed flags, loopback-only compose, read-only/resource limits и exact nginx route с shared IP rate/connection limits.
- API rate key исправлен: лимит применяется по клиенту, а не по сочетанию IP+query. Доверенный `X-Real-IP` устанавливает только site-owned wrapper при явном proxy mode.
- Добавлен explicit static builder с SHA-256 manifest и запретом dirty worktree; API/services/docs/tests/secrets не попадают в payload.
- `10_RELEASE_CHECKLIST.md` разделяет готовый к независимому выпуску static candidate и AI HOLD; deploy/DNS/nginx/container actions не выполнялись.

## Release candidate regression — 2026-10-14 (локально, не production)

- Полный прогон: Node 48/48, Python 46/46, accessibility 4/4, Umami 6/6, sitemap/SEO/schema/links PASS, performance budget PASS.
- Чистый static builder сформировал 49 файлов / 632,617 bytes с SHA-256 manifest; server/API/docs/tests paths в payload отсутствуют.
- Chromium smoke самого payload: 6 PASS, 0 FAIL, 2 ожидаемых `BLOCKED_STATIC_API` для AI page в static-only preview. Страница остаётся fail-closed и не отправляет query.
- `SITE_RELEASE_READY=YES` для independent static Candidate A; `AI_SEARCH_READY=NO`. Production, DNS, nginx, containers, lead data и analytics не менялись.
- После release review process-local cache/rate maps получили жёсткие пределы 500/5000 ключей; уникальные запросы больше не могут неограниченно увеличивать эти структуры.

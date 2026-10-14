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

# Базовая линия программы ТоргАтлас

Дата: 2026-10-14. Источник кода: `1d84a56509c70f8893359ac5374b1a1158130d95` (`origin/main`, GitHub подтверждён read-only запросом). Рабочее дерево программы: `feature/torgatlas-site-master-20261014`.

## Среда и runtime

- OBSERVED: пользователь `deploy`, хост `auction-core-v01`; свободно 74 GiB, load average 0.21/0.28/0.30. Тяжёлые crawler/load-тесты не запускались.
- OBSERVED: отдельный сайтовый worktree создан от актуального `origin/main`; production-каталог `torgatlas-ops` не использовался для разработки.
- UNKNOWN: production HTTP baseline. Разрешённые `GET/HEAD` к `https://torgatlas.ru` 14.10 из этой среды завершились timeout, поэтому runtime статусы, заголовки и `GET /api/lead-config` не подтверждены этой сессией.
- SOURCE_CONFIRMED: release-путь описан в `docs/P3_ALTCHA_SQLITE_RUNBOOK.md`: `www/releases/<sha>` и атомарный `www/current`; deployment не выполнялся.

## Маршруты по исходникам

| URL | Состояние | Индексация / форма |
| --- | --- | --- |
| `/`, `/proverka-lota/`, `/poisk-imushchestva/`, `/soprovozhdenie-torgov/`, `/pokupka-imushchestva/`, `/primery-lotov/`, `/formaty-raboty/` | IMPLEMENTED | canonical на `torgatlas.ru`, index/follow; две локальные карты на профильных страницах |
| `/blog/` и материалы | IMPLEMENTED | 3 редакционно готовые статьи index/follow; 3 новых черновика сохранены с `EDITORIAL_REVIEW_REQUIRED` и noindex |
| `/privacy/`, `/privacy/consent/` | IMPLEMENTED | актуальная редакция privacy — 13.10; прямой приём заявок заявлен как включённый |
| `/ai-poisk-lotov/` | IMPLEMENTED, noindex, FEATURE OFF | fail-closed UI; GIS/ЕФРСБ/МЭТС profiles MOCK_TESTED, live sources не подтверждены |
| `/llms.txt` | IMPLEMENTED (Wave 04) | правдивые ссылки; экспериментальный файл не назван фактором ранжирования |

## Матрица текущего состояния

| Область | Статус | Доказательство / следующее действие |
| --- | --- | --- |
| Карты проверки и поиска без контакта | РЕАЛИЗОВАНО | `assets/lead-tools.js`, browser/contract tests; расширять только после предметного a11y-аудита |
| ALTCHA + SQLite-first direct lead | РЕАЛИЗОВАНО В КОДЕ | `services/lead-intake`, 43 Python-теста PASS; live состояние UNKNOWN из-за timeout |
| Consent-gated Umami | РЕАЛИЗОВАНО В КОДЕ | `assets/analytics.js`, 14 Node-тестов PASS; live network UNKNOWN |
| AI-поиск | РЕАЛИЗОВАН ЛОКАЛЬНО, RELEASE HOLD | собственный Web Research Mini, 0 LLM tokens, source/path allowlist, честное coverage; feature OFF до live/security/shared-rate-limit приёмки |
| Sitemap registry / правдивый lastmod | РЕАЛИЗОВАНО (Wave 02) | `content/public-pages.json` — единственный реестр; generator не подставляет даты без подтверждения |
| Canonical, robots и internal links | РЕАЛИЗОВАНО (Wave 02) | offline validator проверяет registry, XML, robots, H1, canonical, indexability и anchors |
| Keyboard focus главной | РЕАЛИЗОВАНО В КОДЕ (Wave 03) | локальный Chromium baseline 390 px; добавлен общий `:focus-visible` для links/controls |
| Интерактивная приёмка Wave 03B | ЧАСТИЧНО ПРОВЕРЕНО | 11 PASS через локальный Chromium; два BLOCKED: у текущей навигации нет toggle-state, ALTCHA требует отдельный TLS disposable E2E |
| Обработка сетевого сбоя AI | ИСПРАВЛЕНО (Wave 03B) | `TypeError` больше не выводит техническое `Failed to fetch`; отображается безопасная подсказка по первоисточникам |
| Мобильная навигация 320 px | ИСПРАВЛЕНО (Wave 03) | до: обрезанные пункты; после: перенос строк, screenshots `evidence/wave-03/home-320*.png` |
| About/методика/контентная матрица | РЕАЛИЗОВАНО / ЧАСТИЧНО | `/o-torgatlas/` и матрица 30 тем готовы; 3 юридических черновика noindex до owner review |
| Legal/price/payment/CRM/Cloud read-model | ЗАБЛОКИРОВАНО | требуется решение владельца и отдельные legal/security/product gates |
| Search Console/Яндекс Вебмастер | UNKNOWN | доступ владельца не предоставлен; подключение не имитируется |
| Wave 04 SEO/GEO | РЕАЛИЗОВАНО ЛОКАЛЬНО | `/o-torgatlas/`, `llms.txt`, crawler policy, schema validation, registry/sitemap обновлены; индексация и ранжирование остаются UNKNOWN до наблюдений владельца |
| Mobile navigation toggle | NOT_APPLICABLE | мобильный UX — доступный постоянно видимый список ссылок с переносом; browser keyboard navigation PASS, toggle не является технической ошибкой |
| ALTCHA browser E2E | PENDING_INTEGRATION | нужен одноразовый TLS local backend + disposable SQLite, без production или реальных заявок |
| AI UX/CRO Wave 06 | TEST_PASS | disabled/enabled mock states, coverage, provenance, UNKNOWN, CTA и responsive 320/390/768/1440 проверены Chromium; `evidence/wave-06/ai-browser-smoke.json` |

## Проверки исходной базы

Актуальные прогоны и исторические доказательства разделены в `07_TEST_MATRIX.md`; production runtime остаётся UNKNOWN до отдельного разрешённого release/smoke пакета.

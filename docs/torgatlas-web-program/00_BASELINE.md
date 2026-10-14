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
| `/blog/` и 3 статьи | IMPLEMENTED | index/follow, статьи и связующие CTA существуют |
| `/privacy/`, `/privacy/consent/` | IMPLEMENTED | актуальная редакция privacy — 13.10; прямой приём заявок заявлен как включённый |
| `/ai-poisk-lotov/` | IMPLEMENTED, noindex | API source-gated; в этой волне UI исправлен на fail-closed |
| `/llms.txt` | ABSENT | кандидат P1; не доказательство AI-видимости |

## Матрица текущего состояния

| Область | Статус | Доказательство / следующее действие |
| --- | --- | --- |
| Карты проверки и поиска без контакта | РЕАЛИЗОВАНО | `assets/lead-tools.js`, browser/contract tests; расширять только после предметного a11y-аудита |
| ALTCHA + SQLite-first direct lead | РЕАЛИЗОВАНО В КОДЕ | `services/lead-intake`, 43 Python-теста PASS; live состояние UNKNOWN из-за timeout |
| Consent-gated Umami | РЕАЛИЗОВАНО В КОДЕ | `assets/analytics.js`, 14 Node-тестов PASS; live network UNKNOWN |
| AI-поиск | ТРЕБУЕТ ИСПРАВЛЕНИЯ → P0 этой волны | исходный UI мог отправлять query при выключенном сервисе; теперь GET status до разблокировки POST |
| Sitemap registry / правдивый lastmod | РЕАЛИЗОВАНО (Wave 02) | `content/public-pages.json` — единственный реестр; generator не подставляет даты без подтверждения |
| Canonical, robots и internal links | РЕАЛИЗОВАНО (Wave 02) | offline validator проверяет registry, XML, robots, H1, canonical, indexability и anchors |
| Keyboard focus главной | РЕАЛИЗОВАНО В КОДЕ (Wave 03) | локальный Chromium baseline 390 px; добавлен общий `:focus-visible` для links/controls |
| Мобильная навигация 320 px | ИСПРАВЛЕНО (Wave 03) | до: обрезанные пункты; после: перенос строк, screenshots `evidence/wave-03/home-320*.png` |
| About/методика/контентная матрица | ОТСУТСТВУЕТ | нужен PAGE_SPEC и owner-review фактов до публикации |
| Legal/price/payment/CRM/Cloud read-model | ЗАБЛОКИРОВАНО | требуется решение владельца и отдельные legal/security/product gates |
| Search Console/Яндекс Вебмастер | UNKNOWN | доступ владельца не предоставлен; подключение не имитируется |

## Проверки исходной базы

После исправлений этой волны: 23 Node tests PASS, `check-performance.mjs` PASS, 43 Python lead-intake tests PASS, 6 Umami static tests PASS. Полный перечень — `07_TEST_MATRIX.md`.

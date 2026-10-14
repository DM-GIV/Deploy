# Release candidate evidence

Дата: 2026-10-14. Среда: `deploy@auction-core-v01`. Проверка локальная, production не изменён.

## Результаты

- Node: 48/48 PASS.
- Python static/lead/build: 46/46 PASS.
- Accessibility: 4/4 PASS.
- Umami privacy: 6/6 PASS.
- Sitemap/SEO/schema/internal links: PASS, 14 canonical indexable URLs.
- Performance static budget: PASS.
- Static payload: 49 files, 632,617 bytes, SHA-256 manifest; forbidden server paths 0.
- Artifact browser smoke: 4 routes × 2 widths = 6 PASS, 0 FAIL, 2 `BLOCKED_STATIC_API` (AI service намеренно не входит в static payload).
- Disposable lead browser E2E: 26/26 PASS; карта проверки, согласие, реальная ALTCHA proof-of-work, reject/replay/idempotency, SQLite и видимость обращения через owner CLI; внешних запросов и production-записей 0.

## Вердикт

- `SITE_RELEASE_READY=YES`: только static Candidate A, после отдельного разрешения владельца и preflight из `10_RELEASE_CHECKLIST.md`.
- `AI_SEARCH_READY=NO`: GIS/ЕФРСБ/МЭТС только MOCK_TESTED; `PUBLIC_SOURCE_VERIFIED=0`, live lots 0; service/nginx не развёрнуты, flags OFF.
- Три `EDITORIAL_REVIEW_REQUIRED` статьи остаются noindex и вне sitemap.
- ALTCHA browser challenge/pass/reject/replay закрыт в disposable TLS/SQLite-контуре; production POST намеренно не выполнялся, существующий production-контур не менялся.

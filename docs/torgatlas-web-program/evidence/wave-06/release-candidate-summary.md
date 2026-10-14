# Release candidate evidence

Дата: 2026-10-14. Среда: `deploy@auction-core-v01`. Проверка локальная, production не изменён.

## Результаты

- Node: 47/47 PASS.
- Python static/lead/build: 46/46 PASS.
- Accessibility: 4/4 PASS.
- Umami privacy: 6/6 PASS.
- Sitemap/SEO/schema/internal links: PASS, 14 canonical indexable URLs.
- Performance static budget: PASS.
- Static payload: 49 files, 632,617 bytes, SHA-256 manifest; forbidden server paths 0.
- Artifact browser smoke: 4 routes × 2 widths = 6 PASS, 0 FAIL, 2 `BLOCKED_STATIC_API` (AI service намеренно не входит в static payload).

## Вердикт

- `SITE_RELEASE_READY=YES`: только static Candidate A, после отдельного разрешения владельца и preflight из `10_RELEASE_CHECKLIST.md`.
- `AI_SEARCH_READY=NO`: GIS/ЕФРСБ/МЭТС только MOCK_TESTED; `PUBLIC_SOURCE_VERIFIED=0`, live lots 0; service/nginx не развёрнуты, flags OFF.
- Три `EDITORIAL_REVIEW_REQUIRED` статьи остаются noindex и вне sitemap.
- ALTCHA browser challenge/pass/reject/replay остаётся отдельным disposable TLS/SQLite integration debt; unit/API contracts проходят, существующий production-контур не менялся.

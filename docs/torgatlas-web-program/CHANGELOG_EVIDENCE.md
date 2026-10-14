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

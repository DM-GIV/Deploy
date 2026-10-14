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

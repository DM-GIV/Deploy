# Матрица тестов — wave 01

| Уровень | Команда | Результат |
| --- | --- | --- |
| JS contract | `node --test tests/ai-search.test.mjs tests/lead-browser.test.mjs tests/analytics.test.mjs tests/site-release.test.mjs` | PASS, 23/23 |
| Static performance | `node scripts/check-performance.mjs` | PASS; 21,520 B HTML, 15,347 B CSS |
| Syntax | `node --check assets/ai-search.js` и `assets/lead-submit.js` | PASS |
| Lead integration | `python3 -m unittest tests.lead_intake_test tests.leadctl_test` | PASS, 43/43 (temporary loopback, TEST_ONLY SQLite) |
| Umami static | `python3 tests/umami_static_test.py` | PASS, 6/6 |
| Git | `git diff --check` | PASS |
| Public URL contract | `python3 -m unittest tests.site_static_test` | PASS; generated sitemap, registry, canonical, robots and links |
| Static accessibility | `python3 -m unittest tests.accessibility-static-test` | PASS; visible focus and reduced-motion contracts |
| Local browser layout matrix | `scripts/browser-audit.mjs` | 105 unique route×viewport: 98 PASS, 7 BLOCKED_STATIC_API |
| Local interactive browser matrix | `scripts/browser-interactive-audit.mjs` | 11 PASS, 0 FAIL, 2 historically BLOCKED; JSON: `evidence/wave-03/interactive-matrix.json`. ALTCHA is closed by the disposable TLS row below; mobile disclosure is N/A because navigation is intentionally always visible. |
| Direct lead browser E2E | `tests/browser_e2e.py` with proxy variables removed only from the disposable test process | PASS 26/26; real local Chromium + self-signed TLS + ALTCHA proof-of-work + disposable SQLite, map generation, consent gate, reject/replay/idempotency, owner CLI visibility, zero external hosts |
| Wave 04 SEO/schema | `python3 scripts/validate-public-site.py` | PASS; 14 canonical registry URLs, sitemap, robots, internal links and JSON-LD required-type contracts |
| Wave 06 Web Research Mini | `node --test tests/public-web-research.test.mjs tests/ai-search-api.test.mjs tests/ai-search.test.mjs` | PASS; GIS JSON, ЕФРСБ JSON and МЭТС HTML fixtures, normalization, bounded search/detail, coverage, SSRF/DNS/IP, redirects, response size, API gates |
| Wave 06 AI responsive UX | `node scripts/ai-browser-smoke.mjs` | PASS 4/4 widths: 320, 390, 768, 1440; disabled and enabled mock states, no overflow, visible focus, coverage, UNKNOWN and CTA |
| Wave 06 interactive regression | `node scripts/browser-interactive-audit.mjs` | PASS 11, BLOCKED 2 unchanged (mobile disclosure N/A; ALTCHA TLS browser E2E pending) |
| Wave 06 site-owned API runtime | `node --test tests/ai-search-server.test.mjs ...` | PASS; health/fail-closed, invalid JSON/body cap/routes, loopback/resource/nginx templates |
| Static release payload | `python3 -m unittest tests.release_build_test` | PASS; tracked static files + SHA-256 manifest, API/services/docs/tests excluded |

`node` отсутствует в системном PATH; применён локальный бинарник Playwright `.../driver/node` только для выполнения тестов, без установки зависимостей. ALTCHA browser E2E выполнен в отдельном disposable TLS/SQLite-контуре; production POST заявки намеренно не выполнялся.

## Финальный regression release candidate

| Проверка | Результат |
| --- | --- |
| Все Node contracts (`tests/*.test.mjs`) | PASS 48/48 |
| Python static + lead intake/CLI + release builder | PASS 46/46 |
| Static accessibility | PASS 4/4 |
| Umami privacy contracts | PASS 6/6 |
| Sitemap/SEO/schema/internal links | PASS; 14 indexable canonical URL |
| Performance static budget | PASS; homepage HTML 21,584 B, CSS 15,525 B |
| Чистый static payload | PASS; 49 files, 632,617 B, SHA-256 manifest, forbidden server paths 0 |
| Artifact Chromium smoke | 6 PASS, 0 FAIL, 2 `BLOCKED_STATIC_API` ожидаемо для AI page при static-only preview |

Artifact smoke охватил `/`, `/proverka-lota/`, `/blog/`, `/ai-poisk-lotov/` на 320/1440. Два ограничения означают только отсутствие неразвёрнутого AI server в static preview; UI при этом остаётся fail-closed. Production smoke не выполнялся.

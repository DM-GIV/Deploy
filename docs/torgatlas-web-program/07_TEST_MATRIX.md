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
| Local interactive browser matrix | `scripts/browser-interactive-audit.mjs` | 11 PASS, 0 FAIL, 2 BLOCKED; JSON: `evidence/wave-03/interactive-matrix.json` |

`node` отсутствует в системном PATH; применён локальный бинарник Playwright `.../driver/node` только для выполнения тестов, без установки зависимостей. ALTCHA browser E2E требует отдельный disposable TLS/SQLite run; production smoke не выполнялся и не является частью этого пакета.

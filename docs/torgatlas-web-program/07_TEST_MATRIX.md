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

`node` отсутствует в системном PATH; применён локальный бинарник Playwright `.../driver/node` только для выполнения тестов, без установки зависимостей. Browser E2E и production smoke не выполнялись: первый требует отдельного disposable-browser run, второй — доступного runtime без release.

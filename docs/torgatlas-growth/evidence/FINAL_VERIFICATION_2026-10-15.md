# Final verification evidence — 2026-10-15

## PASS

- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p '*test.py' -v` — 61 tests, 61 PASS, exit 0. Для существующих loopback HTTP tests использован разрешённый локальный запуск; внешняя сеть и production не затронуты.
- `/home/deploy/.aa-pw-pkg/playwright/driver/node --test tests/*.test.mjs` — 48 tests, 48 PASS, exit 0. Первый sandbox run дал инфраструктурный FAIL на local listener; разрешённый loopback run прошёл полностью.
- `python3 scripts/validate-public-site.py` — PASS: 14 indexed canonical URLs; sitemap, robots and internal links valid.
- `python3 scripts/generate-sitemap.py --check` — exit 0.
- `python3 scripts/generate-research-showcase.py --at 2026-10-15 --check` — PASS: 10 verified cases, 8 visible, Moscow period 2026-10-13—2026-10-15.
- `node scripts/check-performance.mjs` — PASS; homepage HTML 25 018 bytes, CSS 16 718 bytes, responsive hero preloads 2, missing CSS classes 0.
- `research-showcase-browser-audit.mjs` — 1440: 8 cards/4 columns; 768: 8/2; 390: 8/1; no overflow and no unnamed links, all PASS.
- Editorial scheduler at 2026-10-18 returned `SKIP/no_owner_approved_article`, as required.
- Manual demand import sample accepted 1 valid row; reporting with empty confirmed registry preserved 0 observed keyword/GEO/Umami/lead rows.
- Static builder — 49 files, source commit `1f496351144fa6909c9a277e26f01c9eb1731f8e`, output only in `/tmp`; no deploy.
- `git diff --check` — exit 0 before evidence commit.

## Не заявляется как PASS

- Lighthouse and CrUX: NOT_CONFIGURED/UNKNOWN.
- Real user Core Web Vitals: UNKNOWN.
- Production header/cache matrix beyond observed gzip: UNKNOWN.
- Yandex/Wordstat/GEO answer-engine data: NOT_CONNECTED/UNKNOWN.
- Production release: NOT_RUN.


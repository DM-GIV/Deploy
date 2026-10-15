# HOTFIX-007 — article alignment, CSS cache, home offer (evidence)

ROOT_CAUSE: `/assets/seo.css` was referenced without a version and cached for 86400 s (`public, max-age=86400`). The new article HTML already used `.post-*` rules, so a browser that held the older stylesheet drew the text at the left edge (left 0 px, right margin 600 px at 1440 px — `article-layout-before.txt`, rows `stale`). A fresh profile was fine.

FIX
- every local CSS/JS reference now carries `?v=<sha256[:12]>` (`scripts/fingerprint-assets.py`, run by `scripts/build-site-assets.sh`, checked by `tests/ux_hotfix_test.py` and by `publish-release.sh` before building a release);
- new articles use the same `.intro > .wrap`, `.wrap`/`.article-copy` containers as the three reference articles; the orphan `.post-wrap` rule is removed; column 760 px centred, side padding as in the old articles;
- home H1/subtitle replaced; `text-wrap:balance` on the hero; 1440 px hero height unchanged (796 px), 320 px hero 625 -> 601 px (CTA now on the first screen); see `hero-*.txt`;
- the old offer line in `assets/og-card.png` = `assets/torgatlas-social.png` repainted (`scripts/make-social-card.mjs`); title/description/og text never contained the old offer;
- dates: server clock Europe/Moscow 2026-10-15; generator `MODIFIED` and all `lastmod` set to 2026-10-15; a test fails if any public date is later than today.

CHECKS (local, TEST_ONLY server): `css-cache-probe.txt` (real browser profile with the previous release cached, then the new release: fingerprinted CSS is fetched, margins 340/340 px; cold profile identical), `article-layout-after.txt` (six articles, 1440 and 375: identical centring, no horizontal scroll), screenshots in `screens/` (`before-*` = new HTML with the old cached CSS, `after-*` = fixed).
Note: `content/editorial/queue.json` hash of the unapproved draft `public-property-guide-v1` refreshed because only its asset `?v=` strings changed.

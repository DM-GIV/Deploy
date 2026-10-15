# HERO-SEO-GEO-009

## SEO changes made (home page `/`, static only)
- H1 (one element, two block spans): «Имущество с торгов: от интересного лота до уверенного решения»; no long dashes; «с торгов:» bound by a no-break space.
- Title: «Имущество с торгов: поиск и проверка | ТоргАтлас»; meta description and og:description: «Поиск и проверка имущества с торгов, включая торги по банкротству. Помогаем изучить документы, оценить стоимость и условия приобретения по всей России»; og:title = Title.
- JSON-LD ProfessionalService: description widened («с торгов, включая торги по банкротству»), explicit sentence that coverage of specific platforms is clarified per object; slogan no longer «Все имущественные торги России»; phone, e-mail, url, sameAs, canonical and URLs unchanged.
- Natural keyword placement without new sections: H2 «Покупка имущества с торгов: выберите свой сценарий», H2 «Проверка лота и помощь на нужном этапе», «О проекте» says «включая торги по банкротству» and «Мы не утверждаем, что охватываем все площадки».
- Count claim: home «до 5 предложений» -> «до 10 предложений» (API `max_results:10`). The AI page already said «до 10 подходящих лотов»; no other public page states a count (grep over html/txt/json). Stale «До 5 результатов» assertions in `scripts/ai-live-captcha-smoke.mjs` and `scripts/ai-core-e2e.mjs` aligned. Search algorithms untouched.
- Social card (`assets/og-card.png` = `assets/torgatlas-social.png`) bottom line replaced; `llms.txt` home line widened and states no full-platform coverage.

## Verified (actual HTML)
Home and AI page: no noindex, canonical present, both in sitemap.xml (18 URLs), robots.txt allows `/` and points to the sitemap, JSON-LD valid, internal links valid (`validate-public-site.py`, `seo-crawl.mjs` 85/85). No Lighthouse or ranking claims (not measured).

## Open decisions for the owner
1. The visible header tagline «Все имущественные торги России» (all pages) and the social card heading still read as full coverage. Not changed because only the offer block was approved; recommend replacing with e.g. «Имущественные торги: поиск и проверка».
2. Google Search Console (no access from this host): in Sitemaps remove the wrongly submitted entry `https://torgatlas.ru/ai-poisk-lotov/` (it is a page, not a sitemap; do NOT delete the page), keep `https://torgatlas.ru/sitemap.xml` (0 errors); then URL Inspection -> `https://torgatlas.ru/` and `https://torgatlas.ru/ai-poisk-lotov/` -> «Запросить индексирование».
Release 8b362435acdcc829c4f0f7a4ea51128c2425fa75 (site only, 2026-10-15T19:15Z). Rollback: scripts/publish-release.sh db7092539779bf2a2290b83a96580acff816db22. Live: seo-crawl 85/85, e2e 102/102, public-smoke 32/32.

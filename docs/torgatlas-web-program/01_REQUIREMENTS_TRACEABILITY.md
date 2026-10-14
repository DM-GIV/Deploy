# Трассировка требований — wave 01

| Requirement | До | Изменение / доказательство | После |
| --- | --- | --- | --- |
| §01: отдельный актуальный worktree | отсутствовал | создан от `origin/main` `1d84a565` | IMPLEMENTED |
| §01/§19: не отправлять ввод при выключенном сервисе | AI UI мог выполнить POST после submit | `assets/ai-search.js`: GET config, controls disabled до `enabled:true` | TEST_PASS |
| §04/§05: честное объяснение инструмента | hero AI обещал подборку без оговорки gate | `ai-poisk-lotov/index.html` описывает предварительный и gated характер | TEST_PASS |
| §20: analytics event соответствует текущему флагу | тест ожидал устаревший disabled state | `tests/analytics.test.mjs` проверяет true и false flag | TEST_PASS |
| §17: performance check допускает fingerprint | cache-busting query ломал тест | `scripts/check-performance.mjs` допускает только versioned hash | TEST_PASS |
| §09: canonical URL registry/sitemap | статичный sitemap с old lastmod | registry + generator + offline validator | TEST_PASS |
| §08/§12/§14: новые публичные контентные страницы | не начато | PAGE_SPEC + owner/factual review | P1 / PENDING_OWNER_APPROVAL |
| §06/§18: реальные интерактивные действия и consent-gated analytics | только static/DOM evidence | local Chromium actions + intercepted `/ta/` and AI API mocks | TEST_PASS (11 scenarios) |
| §06: ALTCHA challenge/replay browser E2E | не запущено | existing TLS disposable harness needs separately available browser adapter | BLOCKED, evidence recorded |
| §09/§10: SEO/GEO public identity and machine-readable navigation | no about page or llms file | `/o-torgatlas/`, `llms.txt`, route registry, validated schema and crawler rules | TEST_PASS / live visibility UNKNOWN |
| §11: structured data truthful types | inconsistent coverage was unverified | validator parses JSON-LD; WebSite/ProfessionalService, Service, WebPage, BreadcrumbList checked | TEST_PASS |
| §04/§18: собственный публичный web research без внешнего AI-search | OpenAI web_search dependency | deterministic planner + GIS/ЕФРСБ/МЭТС profiles; V1/V2/TinyFish/Cloud не вызываются | MOCK_TESTED; live sources BLOCKED |
| §18/§19: SSRF, бюджеты, cache/rate/concurrency | отсутствовал самостоятельный transport | exact HTTPS host/path allowlist, DNS/public-IP pin, redirect/type/size/time limits, 12-request budget, 0 LLM tokens | TEST_PASS; shared multi-instance rate limit PENDING |
| §04/§05/§06: понятный и честный AI UX | карточки скрывали coverage/provenance и общий UNKNOWN | реальные source/checked-at/status, coverage note, примеры, empty/error states, карта проверки CTA | TEST_PASS: 4 responsive widths + 5 interactive API states |

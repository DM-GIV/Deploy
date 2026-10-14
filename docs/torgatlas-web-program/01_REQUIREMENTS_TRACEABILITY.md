# Трассировка требований — wave 01

| Requirement | До | Изменение / доказательство | После |
| --- | --- | --- | --- |
| §01: отдельный актуальный worktree | отсутствовал | создан от `origin/main` `1d84a565` | IMPLEMENTED |
| §01/§19: не отправлять ввод при выключенном сервисе | AI UI мог выполнить POST после submit | `assets/ai-search.js`: GET config, controls disabled до `enabled:true` | TEST_PASS |
| §04/§05: честное объяснение инструмента | hero AI обещал подборку без оговорки gate | `ai-poisk-lotov/index.html` описывает предварительный и gated характер | TEST_PASS |
| §20: analytics event соответствует текущему флагу | тест ожидал устаревший disabled state | `tests/analytics.test.mjs` проверяет true и false flag | TEST_PASS |
| §17: performance check допускает fingerprint | cache-busting query ломал тест | `scripts/check-performance.mjs` допускает только versioned hash | TEST_PASS |
| §09: canonical URL registry/sitemap | статичный sitemap с old lastmod | не начато | P1 |
| §08/§12/§14: новые публичные контентные страницы | не начато | PAGE_SPEC + owner/factual review | P1 / PENDING_OWNER_APPROVAL |

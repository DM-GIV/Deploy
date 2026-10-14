# Wave 06 source matrix

| Источник | Контракт | Состояние | Evidence |
| --- | --- | --- | --- |
| ГИС Торги | public `lotcards/search` + fixed lot detail | `MOCK_TESTED`, live `SOURCE_BLOCKED` | Local historical Cloud fixtures read-only; 2026-10-14 live probe returned `SOURCE_NETWORK_ERROR` in 80 ms, 0 lots |
| ЕФРСБ | `/backend/biddings?limit=5&offset=0|5`, bidding/message by GUID | `MOCK_TESTED`, live `SOURCE_BLOCKED` | Read-only Scanner 6.9.1 contract; local TEST_ONLY list/detail/message fixtures; live egress returned HTTP 403 via local proxy, 0 lots |
| МЭТС | `GET /` bounded event feed + `GET /{trade}-{lot}` | `MOCK_TESTED`, live `SOURCE_BLOCKED` | Read-only AUC-45 research; local TEST_ONLY HTML feed/detail fixtures; live egress timed out at 4 s, 0 lots |
| РАД/Lot-online | exact `products.view&product_id=N` only | `POLICY_LIMITED_EXACT_DETAIL`; no discovery profile | Read-only AUC-39 says catalogue/search/paging are forbidden and exact cards require a candidate from another source |

Fixture results are never classified as current lots. `PUBLIC_SOURCE_VERIFIED=0`, `PRODUCTION_VERIFIED=0`, live verified lots: 0. Обычный fixture-сценарий: GIS 3 HTTP requests, ЕФРСБ 3, МЭТС 2; LLM calls/tokens always 0.

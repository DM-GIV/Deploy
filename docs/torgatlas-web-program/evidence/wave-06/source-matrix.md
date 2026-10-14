# Wave 06 source matrix

| Источник | Контракт | Состояние | Evidence |
| --- | --- | --- | --- |
| ГИС Торги | public `lotcards/search` + fixed lot detail | `MOCK_TESTED`, live `SOURCE_BLOCKED` | Local historical Cloud fixtures read-only; 2026-10-14 live probe returned `SOURCE_NETWORK_ERROR` in 80 ms, 0 lots |
| ЕФРСБ | historical `/backend/biddings` family | `PENDING_REFERENCE_REVIEW`; earlier root probe 401 | No adapter enabled |
| МЭТС | public web pages | `SOURCE_BLOCKED` on earlier root probe (403) | No bypass, no adapter enabled |
| РАД/Lot-online | public web pages | `SOURCE_BLOCKED` on earlier root probe (timeout) | No bypass, no adapter enabled |

Fixture results are never classified as current lots. `PUBLIC_SOURCE_VERIFIED=0`, `PRODUCTION_VERIFIED=0`, live verified lots: 0.

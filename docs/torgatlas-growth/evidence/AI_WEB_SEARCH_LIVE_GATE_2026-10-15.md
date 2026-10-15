# Public AI Web Search live gate — 2026-10-15

Observed at `2026-10-15 02:26 MSK` from the Selectel host. Requests were read-only, unauthenticated and bounded. The engine used the host's approved HTTPS proxy without logging its value. No CAPTCHA or access-control bypass was attempted.

## Live routes

- `bankrupt.utpl.ru` (ОТП): `LIVE_VERIFIED`. Both first public catalog pages and exact lot cards returned HTTP content. Three natural-language searches completed in 693–1,360 ms engine time.
- ГИС Торги, ЕФРСБ and МЭТС: adapters, allowlisted routes, parsers, failure isolation and TEST_ONLY fixtures are implemented. Direct live probes on this host were timeout/403 during the gate; they are fallback routes, not claimed `LIVE_VERIFIED`.
- Other ETPs can be added to the same allowlist/normalization contract. The public UI never asks the visitor to select a platform. Search-engine snippets are never promoted to verified lots.

## Three live searches

1. `Найди транспорт на торгах` — 693 ms, 4 public pages, 2 verified lots. Examples: ОТП `127861` Audi A1, 1,190,000 RUB, applications through `2026-11-18 18:00 MSK`; ОТП `127862` Mitsubishi Outlander, 1,250,000 RUB, same deadline.
2. `Найди оборудование на открытых торгах` — 1,360 ms, 9 public pages, 7 verified lots. Examples: ОТП `127737` rolls, 496,678 RUB; `127740` powder-wire line, 532,818 RUB; `127744` CNC plasma pipe cutter, 321,135.30 RUB. Source status was `Прием заявок`, deadline `2026-11-11 18:00 MSK`.
3. `Найди недвижимость на публичном предложении` — 1,169 ms, 7 public pages, 5 verified lots. Examples: ОТП `127847` non-residential premises in Tyumen, current source price 29,112,300 RUB, final interval `2026-12-08 15:00 MSK`; `127827` building in Stavropol Krai, current source price 12,156,000.30 RUB, final interval `2026-11-30 23:59 MSK`.

Every returned item had a direct exact-card URL, source lot id, source status, future application deadline, price meaning and `checked_at`. Deduplication key is source + source lot id. `UNKNOWN`, expired and terminal statuses are excluded from live-verified output.

## Runtime/security/load evidence

- Loopback API E2E: HTTP 200, 775 ms, 2 verified transport lots from a real public source.
- Bounded load smoke: four concurrent API calls completed in 816 ms; two performed searches and two returned `BUSY`. This proves the process-local maximum of two concurrent research jobs; nginx templates add per-IP request and connection limits.
- SSRF gates allow only exact HTTPS catalog/detail patterns. Unit tests cover private/loopback/link-local rejection, DNS pinning, redirects, response size, body size, content type, origin, query shape and failure isolation.
- Proxy CONNECT targets the already DNS-checked public IP and retains TLS SNI validation. Proxy credentials, if configured by the host, are read only at runtime and are not logged or stored in Git.

The gate establishes a working MVP route, not complete coverage of all auctions. Source availability and lot status can change and must be rechecked at display time.

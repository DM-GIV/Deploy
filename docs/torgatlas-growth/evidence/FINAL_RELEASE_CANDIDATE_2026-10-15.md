# Final release candidate evidence — 2026-10-15

Release candidate source starts from `1cfefd1c20a4a944defc3af0a7ef5b1269b70800` and consists of atomic implementation commits `4fea437`, `aa33703`, `143445f` plus this evidence commit.

## Passed gates

- Python suite: 66/66 PASS before the release-safety commit; the affected release-builder subset was rerun after it and passed 6/6.
- Node suite: 55/55 PASS before the contact clipboard tests; those two additional behaviours passed in the targeted run. A final full run is required on clean HEAD before build.
- Public site validator: 14 indexed canonical URLs, sitemap, robots and internal links PASS.
- Editorial decision for 2026-10-18: `SKIP/no_owner_approved_article`.
- Disabled lot scheduler: `SKIP/scheduler_disabled`; month-boundary and same-slot idempotency tests PASS.
- Performance budget: home HTML 26,470 bytes; main CSS 16,718 bytes; contact CSS 1,289 bytes; responsive hero preloads 2; PASS.
- Local browser matrix: 60 PASS, 0 FAIL, 4 `BLOCKED_STATIC_API` across 320/390/768/1440. The four blocked cells are the AI page in static-only preview where `/api/ai-lot-search` intentionally does not exist. Live API E2E was tested separately.
- Owner-provided PSI desktop baseline from 2026-10-15 00:14 MSK remains 100/92/100/100 with FCP 0.2 s, LCP 0.3 s, TBT 0 ms and CLS 0. A repeat external PSI/CrUX reading is `UNKNOWN`; no result is invented.

## Release boundaries

- A: accessible static UI, contact icons, contrast/link/focus fixes, AI-page simplification and safe static infrastructure — eligible after the final clean test/build gate.
- B: AI API daemon/reverse proxy — implementation and live E2E are ready, but installing a new daemon/listener and nginx includes requires the separate infrastructure approval specified by the owner. Until then the page remains honest and inactive.
- B rotation: exactly-eight snapshot builder is ready and disabled. Production timer is not installed; historical research remains clearly labelled and is not treated as live inventory.
- C: introductory article is `DRAFT_FOR_OWNER_APPROVAL`, `noindex`, absent from registry/sitemap and explicitly excluded from static release payload. VK/Dzen packages remain drafts for unconfirmed channels.

The CSP/COOP templates are Report-Only proposals and are not activated. Existing HSTS is not expanded to `includeSubDomains` or `preload`.

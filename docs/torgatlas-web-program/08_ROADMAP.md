# Roadmap

1. P0 DONE: source-backed registry индексируемых URL → generator sitemap/`lastmod` → static validator.
2. P0 PARTIAL: URL/a11y browser baseline завершён (105 route×viewport: 98 PASS, 7 static-API BLOCKED); Wave 03B interactive: 11 PASS, 0 FAIL, 2 documented BLOCKED. Для DONE нужен отдельный disposable TLS ALTCHA E2E, а toggle-menu неприменим к реализованной always-visible navigation.
3. P0 DONE (Wave 04): техническая SEO/GEO baseline — `/o-torgatlas/`, `llms.txt`, crawler policy, schema checks, canonical registry and sitemap. Search Console/Яндекс и live indexing остаются OWNER/OBSERVATION.
4. P0 NEXT: тематические content-clusters и PAGE_SPEC для новых статей/методики; создавать только оригинальные source-backed материалы без каннибализации существующих URL.
5. P1: PAGE_SPEC для `/metodika/`; публикация только после фактической проверки владельцем.
6. P1: content matrix 30 вопросов как DRAFT с источниками и review status, без массовой публикации.
7. BLOCKED: тарифы, оплата, Cloud read-model, CRM, изменение ПД-политики, DNS и deployment — только отдельные решения владельца.
8. P0 PARTIAL / RELEASE HOLD (Wave 06): GIS, ЕФРСБ and bounded-feed МЭТС profiles are fixture-tested; responsive/interactive UX is complete locally. All live probes remain SOURCE_BLOCKED; RAD is exact-detail-only. Public feature flag remains OFF until live/security acceptance, production egress validation and durable shared rate limiting.
9. P0 DONE / OWNER GATE: reproducible static builder, clean-SHA manifest, targeted artifact smoke and release/rollback checklist complete. Main static candidate готов к отдельному owner-approved выпуску; production не изменён.
10. HOLD: AI service deployment/activation — только после live source E2E, production egress/security/shared-rate validation и отдельного разрешения. До этого AI page остаётся noindex/fail-closed.

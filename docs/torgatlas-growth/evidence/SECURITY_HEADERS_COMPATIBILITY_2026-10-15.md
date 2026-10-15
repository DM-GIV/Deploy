# Security headers compatibility — 2026-10-15

Status: `TESTED_ONLY`, production configuration unchanged.

- Existing production headers observed: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, short `Strict-Transport-Security: max-age=300`.
- `includeSubDomains` and `preload` remain forbidden until every present and future subdomain, including `app.torgatlas.ru`, is verified for permanent HTTPS.
- The repository contains a CSP Report-Only template. It allows only the site, the current Umami endpoint, self-hosted assets and the existing Unsplash hero image. It does not add a video provider because none is approved.
- Enforcement is intentionally not activated in the static release. A Report-Only observation window and review of ALTCHA, lead forms, Umami consent behaviour and future video embeds are required first.
- COOP is likewise prepared as Report-Only. Trusted Types are not activated; they are not a substitute for output escaping and would require a separate browser/runtime compatibility gate.

# AUC-204/P3 — TorgAtlas direct-lead release gate

Status: IMPLEMENTATION IN DEVELOPMENT. NOT DEPLOYED; PERSONAL-DATA COLLECTION DISABLED.
Repository: DM-GIV/Deploy. Source branch starts at verified origin/main 6eff42605bd1a65ac39c0835710e75d839c9c422; accepted production site remains 7de37359697c990f42cd8e3bc372af09ed95a622.

## Architecture

A self-contained Python 3.12 website-only service at services/lead-intake/lead_intake.py with standard-library dependencies, isolated SQLite file and SMTP sender. No connection to Auction Analytics Cloud/Core/PostgreSQL/Redis/Scanner. Standalone Compose sample binds ONLY 127.0.0.1:18081 on the host; container is non-root, limited resource, read-only FS, private separately approved host data dir. Website fallback links (TG, MAX, email, copy) are unaffected.

Do not run production Compose or modify nginx in this Git-only package. Current public HTTP contract continues: GET /api/lead-config -> 200 {"enabled":false}; POST /api/lead -> 503 NOT_CONFIGURED.

## Default safe settings

Both DIRECT_LEADS_ENABLED and DIRECT_LEADS_LEGAL_APPROVED default to false. Even when both are true, configuration requires SMARTCAPTCHA_SITE_KEY, SMARTCAPTCHA_SECRET, LEAD_ALLOWED_ORIGIN=https://torgatlas.ru, SMTP_HOST, SMTP_PORT (465 or 587), SMTP_USER, SMTP_PASSWORD, SMTP_FROM, LEAD_EMAIL_TO, DATA_DB_PATH (absolute path), LEAD_HASH_SALT (>=32 characters). No real credentials, recipient or private keys in Git. env.example is deliberately disabled and blank. The service performs no DB access or network call when disabled.

## API contract

GET /api/lead-config returns enabled:false until all gates pass, then enabled:true and ONLY public siteKey.
POST /api/lead requires JSON up to 12,288 bytes; strict Origin matching https://torgatlas.ru; kind lot|search, contact 5–180 characters, message 40–6000, consent=true, privacyVersion, empty website honeypot, one-time captchaToken, UUID-v4 id. Old Turnstile tokens are rejected. No unauthenticated writes.
Captcha verification: POST form-urlencoded secret/token/ip (optional trusted original IP) to https://smartcaptcha.cloud.yandex.ru/validate, require HTTP 200, status ok AND host torgatlas.ru; invalid/expired/timeout/unknown host fail closed. Source: https://yandex.cloud/ru/docs/smartcaptcha/operations/validate-captcha
After validation, SQLite reserves UUID with pending_delivery, then SMTP over TLS with explicit acknowledgement. Only after confirmed SMTP send and accepted SQLite status, response includes BOTH {ok:true, code:"ACCEPTED", receipt:id} and {accepted:true, id:id}. SMTP fail or timeout -> delivery_unknown, do not claim acceptance; no automatic replay for ambiguous delivery. Repeated identical accepted UUID returns same response without second message, changed payload with same UUID returns 409. No files accepted; logs exclude contact/message/IP/token and there is no raw IP stored. In-process rate cap 20/min per HMAC-IP; deployment additionally requires site-owned nginx limit_req and trustworthy X-Real-IP forwarding.

## Disabled production deployment is a SEPARATE approved package

1. Verify data-operator identity, legal processing purpose in Roskomnadzor notification, final policy/consent, exact retention, Russian storage and mail/captcha processors. Current RKN issue: previously registered purpose only HR/accounting; no claim of legal compliance from this PR.
2. Owner-supplied SmartCaptcha keys (real torgatlas.ru site key + server secret), approved sender/SMTP credentials and verified recipient, secure host data dir and hash salt. Never invent credentials or mailbox.
3. Disposable test DB + mocked and then live authorized SmartCaptcha and SMTP delivery acceptance. Security review: captcha errors, concurrency, SQLite restart, rate-limits, origin and body bounds, no sensitive logs.
4. Disabled-only isolated Compose deployment to localhost, health check enabled:false and zero PII, then separately reviewed site-only nginx routing from current stub to service with rollback; do not touch shared Cloud Core/proxy config without production preflight.
5. Enable DIRECT_LEADS_ENABLED and DIRECT_LEADS_LEGAL_APPROVED only after explicit operator/legal acceptance. Update /privacy/ in that separate activation release and test browser flow. Disabled release is not an operational lead funnel.

## Retention and backups

retention.py dry-runs only by default. Requires LEAD_RETENTION_DAYS between 30 and 3650, LEAD_RETENTION_LEGAL_APPROVED=true, and explicit --execute before any deletion of accepted records. No timer/scheduler, no production cleanup authorized, no backup handling implemented. Ambiguous/pending delivery not auto-deleted. The proposed 12 months is LEGAL_PENDING, not approved.

## Tests

Run:
python3 -m unittest discover -s tests -p lead_intake_test.py -v
node --test tests/lead-browser.test.mjs
node --test tests/direct-lead.test.mjs
node --test tests/analytics.test.mjs
node scripts/check-performance.mjs
node --check assets/lead-submit.js
git diff --check

Tests are offline synthetic fixtures; passing does not prove real captcha/SMTP, live delivery or legal acceptance. Vercel API files remain legacy compatibility tests and are not server runtime.

## Rollback

This PR only changes Git, not production. Revert branch/merge if rejected. A later isolated disabled deployment must snapshot site-owned nginx include and container image/config, and stop only its own container on rollback. Restore previous 200 enabled:false / POST 503 contract and Cloud 308/200/200/404 health. Never reset/clean other worktrees.

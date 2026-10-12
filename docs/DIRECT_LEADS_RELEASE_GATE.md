# Direct leads — release gate and contract (ALTCHA + SQLite first)

Supersedes the earlier SmartCaptcha/SMTP-first contract. Runbook: `docs/P3_ALTCHA_SQLITE_RUNBOOK.md`. Third-party notice: `docs/ALTCHA_VENDOR_NOTICE.md`.

## Acceptance means one thing
HTTP 200 `{ok:true,code:"ACCEPTED",accepted:true,receipt,id}` is returned only after a durable SQLite COMMIT (`synchronous=FULL`) that wrote the lead **and** consumed the ALTCHA challenge in the same `BEGIN IMMEDIATE` transaction. Any SQLite/commit/disk/permission error returns 503 `UNAVAILABLE` and nothing is accepted. SMTP is optional, best-effort and strictly after the commit; its outcome (`not_configured|pending|sending|sent|failed`) never changes acceptance and is never retried automatically after an ambiguous attempt.

## Activation gate (all must hold, else `GET /api/lead-config` stays `{"enabled":false}` and POST → 503 before reading the body)
`DIRECT_LEADS_ENABLED=true`, `DIRECT_LEADS_LEGAL_APPROVED=true` (owner's confirmation of the legal prerequisite — never set by engineers on assumption), `LEAD_ALLOWED_ORIGIN=https://torgatlas.ru`, `LEAD_CONSENT_VERSION` in the accepted set (`2026-10-12.2`), absolute `DATA_DB_PATH`, distinct strong local secrets `LEAD_HASH_SALT` and `ALTCHA_HMAC_KEY` (≥32 chars), and a runtime-ready database (private 0700/0600, migrated, `synchronous=FULL`). `SMTP_*`, SmartCaptcha and any external network are irrelevant to the gate.

## Contract
- `GET /api/altcha-challenge` → 200 ALTCHA v1 JSON `{algorithm:"SHA-256",challenge,maxnumber:300000,salt(?expires=now+600&),signature}`, `Cache-Control: no-store`, 30/min per HMAC-IP in app + nginx 10/min burst 6.
- `POST /api/lead` JSON ≤12288 B, `Origin: https://torgatlas.ru`, `Content-Type: application/json`, fields `id`(UUID v4) `kind`(lot|search) `contact`(5–180) `message`(40–6000) `consent:true` `privacyVersion` `website:""` `altcha`(base64 payload ≤2048). Errors: 403 ORIGIN_DENIED/CAPTCHA_FAILED/CAPTCHA_REPLAY, 409 ID_CONFLICT, 411/413/415/422/429/503.
- Idempotency: same UUID + identical normalized payload → the original receipt, no insert, no mail; same UUID + other data → 409. A challenge is single-use across restarts (`altcha_used` primary key) and for concurrent requests (SQLite write lock).
- No contact, message, CAPTCHA payload, IP or full receipt in logs, Umami or Linear. IP is stored only as an HMAC.

## Still outside engineering control (activation blocker)
Written owner confirmation that the Roskomnadzor operator-registry entry covers client-enquiry processing (policy of 12.10.2026 says the notification was sent via ESIA; registry confirmation is absent) and acceptance of the final policy/consent text and a retention period. Until then keep `DIRECT_LEADS_LEGAL_APPROVED=false`.

## Tests
```
python3 -m unittest tests.lead_intake_test tests.leadctl_test
python3 tests/umami_static_test.py
node --test tests/lead-browser.test.mjs tests/analytics.test.mjs tests/site-release.test.mjs
node scripts/check-performance.mjs; node --check assets/lead-submit.js; git diff --check
python3 tests/browser_e2e.py     # real Chromium, see runbook for the throwaway container command
```
Tests use disposable DBs and TEST_ONLY fixtures; they do not prove production behaviour.

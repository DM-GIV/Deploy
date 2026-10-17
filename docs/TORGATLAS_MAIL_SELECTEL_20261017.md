# TORGATLAS-MAIL-SELECTEL-001 / 2026-10-17

**Status: CODE PREPARED; EXTERNAL SELECTEL SETUP NOT VERIFIED; PRODUCTION NOT MODIFIED BY THIS BRANCH.**

## Scope

Existing site-only `services/lead-intake` already supports optional SMTP notifications after a durable SQLite acceptance. It has been extended to support Selectel's relay ports 1127 (implicit TLS) and 1126 (STARTTLS), retaining legacy 465/587 behavior. The availability of these ports from the actual server has **not** been verified.

Official source: https://docs.selectel.ru/email-service/connect-email-service/
Background: https://docs.selectel.ru/email-service/about/about-email-service/

## External preconditions (must be done in the authorized Selectel account)

1. In Selectel **Products → Email Service**, check if a mail resource exists; do not create duplicates.
2. If none exists, create a resource for transactional messages. Register `torgatlas.ru` using the TXT ownership token shown by Selectel. Do not copy tokens into Git or chat.
3. Verify DNS state; merge SPF into the **existing** SPF record instead of creating a duplicate. Configure DKIM/DMARC using the actual Selectel-provided values, without overwriting unrelated mail settings. DNS work is a separate controlled change.
4. Record non-secret verification evidence of confirmed domain/resource status. Store SMTP username/password only in restricted server environment/secrets, not in Git, issues, logs or shell history.
5. Configure site-only mail environment:
   - `SMTP_HOST=smtp.mail.selcloud.ru`
   - `SMTP_PORT=1127` (implicit TLS; 1126 / STARTTLS as documented fallback)
   - `SMTP_USER=<FROM_SELECTEL_SECRET_STORE>`
   - `SMTP_PASSWORD=<FROM_SELECTEL_SECRET_STORE>`
   - `SMTP_FROM=<verified-address>@torgatlas.ru`
   - `LEAD_EMAIL_TO=<authorized-existing-inbox>` (current owner-supplied inbox is a Yandex address).
6. From approved server test TCP/TLS connectivity and certificate hostname verification to port 1127. Test AUTH without printing secret values.
7. Send one authorized **synthetic** email, confirm receipt and SPF/DKIM/DMARC results in the recipient mailbox. Do not send real lead information for test.
8. Check normal and refusal/timeout/error cases; preserve durable receipt, idempotency, and unchanged lead-intake/Telegram functionality.
9. Only then enable SMTP in the real site service via its existing deployment/runbook and site-only release process; perform postrelease verification and maintain rollback.

## Consent UI adjustment in same preparation branch

- On first visit, Yandex Metrika checkbox is visually selected if no previous Metrika choice is stored.
- **No Yandex request is made before explicit positive acceptance**, e.g. “Принять выбранное” / “Принять всё”. Mere page visit, silence, scroll, or a displayed checkmark does not grant consent.
- “Отказаться от всего” records rejection of optional analytics. Site access and lead forms are preserved.
- Umami remains independently off unless accepted. Existing preferences and revocation override visual defaults.
- Preselection is a legal UX risk; verify against current article 9 of 152-FZ, applicable geography/cookie rules, and documented evidence requirements before live release. The change does not itself establish that a prechecked option is valid consent.
- Browser and static tests have been updated in this branch; local full-suite and live production tests still need to be executed on the authorized server.

## Release safety

Production reported at start: `5d6e2a906727523941c0de1b06165ec0aab93882` (last reported by Claude Code; verify against live current symlink). This branch is **not** a production deploy. Do not assume normal static website publish script updates service/container SMTP runtime. Use the existing specific lead-intake runbook. No Cloud4/DB/DNS/global Nginx changes without their own authorization and preflight. Never send a test real lead or execute blind network/secret mutations.

## Primary references

- https://mintrud.gov.ru/docs/laws/130 — 152-FZ article 9 (current posted text, verify revision)
- https://yandex.ru/legal/metrica_termsofuse/ru/ — clauses 5.4.1 and 5.5
- https://docs.selectel.ru/email-service/connect-email-service/ — ports and DNS steps

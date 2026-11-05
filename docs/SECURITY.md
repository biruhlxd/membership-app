# Security: data loss prevention and incident response

How Biruh Membership protects merchant and customer data, and what to do
when something goes wrong. Owner: Biruh Alemnew (the only person with
access). Review this once a year and after any incident. Last reviewed
2026-11-05.

## What personal data the app holds

| Data | Where | Protection |
| --- | --- | --- |
| Customer and subscription IDs, membership status and dates, renewal charges | MySQL `biruhorg_membership` | Database login, server access |
| Email addresses the app sent to (EmailLog) | MySQL | Encrypted (AES-256-GCM, key `DATA_KEY`) |
| Invited seat email addresses | MySQL, Seat | Encrypted; looked up by a keyed hash (HMAC-SHA256), never in plain text |
| Credential holder's short name ("Ana B.") | MySQL, Credential | Encrypted |
| Shopify access tokens | MySQL, Session | Database login, server access; tokens expire and refresh |
| Access log (who read customer data, when) | MySQL, AccessLog | Kept 12 months |

The encryption key lives only in the server's app settings
(`~/biruh-membership-secrets/env.json`), never in the database or git. **A
copy of the key and the backup key must be kept offline** (password
manager): without them encrypted data and backups can't be read.

## Data loss prevention

- **Least data:** only name and email are requested from Shopify; names are
  stored only as the credential holder's first name and last initial.
- **Access:** one person (Biruh). Shopify, GitHub, Google and cPanel accounts
  use strong unique passwords and two-step verification. Server access is by
  SSH key only.
- **Separation:** live data only on the live server; development uses dev
  stores, the dev app and a local SQLite database with test data.
- **In transit:** HTTPS for every request (valid certificate, no HTTP
  fallback); email is sent over TLS.
- **Shopify tokens:** the app's Admin API access only works from the
  server's address (Shopify IP allowlist, 192.250.229.92).
- **Payments:** card details never reach the app; Shopify charges renewals.
- **Backups:** every night at 03:17 server time the database is dumped,
  compressed and encrypted (AES-256, key `~/app-backups/backup.key`) into
  `~/app-backups/`, kept 14 days. The web host's own backups only ever see
  encrypted customer fields.
- **Restore:** `openssl enc -d -aes-256-cbc -pbkdf2 -pass file:backup.key -in
  <file>.sql.gz.enc | gunzip | mysql biruhorg_membership` into an empty
  database, then start the app. Test a restore every 6 months.
- **Deletion:** Shopify's shop and customer deletion webhooks delete the
  store's or customer's data.
- **Logging:** every view of customer data in the admin (Members,
  Credentials) and every privacy request is recorded in the access log.

## Incident response

An incident is anything that may have exposed, changed or lost customer or
merchant data: a leaked key or token, unknown access, a lost device, a
vulnerability being used, or data sent to the wrong place.

1. **Contain (within the hour):** stop the app (cPanel › Node.js app › Stop)
   if data is still leaking, and rotate what leaked: Shopify app secret (Dev
   Dashboard), `RENEWALS_JOB_SECRET`, database and SMTP passwords. Do NOT
   rotate `DATA_KEY` without re-encrypting the data. Renewals wait while the
   app is stopped and are charged when it restarts.
2. **Assess (same day):** what data, which shops and members, since when,
   how. Use the access log, the app log
   (`~/biruh-membership-logs/app.log`), cPanel access logs and Shopify's app
   logs. Keep notes with times.
3. **Notify (within 72 hours of knowing):** each affected merchant by email
   with what happened, what data, what we did and what they should do; and
   Shopify through Partner support. Merchants decide whether to tell their
   members or a regulator; help them with the facts.
4. **Fix and recover:** fix the cause, restore from backup if data was lost
   or changed, and deploy.
5. **Review (within 2 weeks):** write what happened and what changes; update
   this document.

Contact for merchants: biruh@biruh.org.

# Biruh Membership

Biruh Membership, by Biruh Tech (Biruh Alemnew): a Shopify membership app
for associations and education organizations:
membership plans on Shopify subscriptions, organization seats, credentials
with expiry, and a link to a learning platform (Moodle first).

Product plan: https://claude.ai/artifact/WMFWsV3bGbEUoR2KKEdUyi

## Stack

Shopify's React Router app template: TypeScript, React Router, Polaris,
Prisma (SQLite in development, PostgreSQL in production).

## Layout

- `app/membership/`: membership rules as pure functions, with tests
  - `billing.ts`: per-cycle prices, billing-attempt idempotency keys
  - `dunning.ts`: retries after a failed renewal, when a membership lapses
  - `status.ts`: member status, access, customer tags per plan
- `prisma/schema.prisma`: plans, memberships, billing attempts
- `app/routes/`: admin pages and webhooks

Billing dates come from Shopify: each contract's billing cycles carry their
own expected billing date, and the app bills the cycles that are due.

## Develop

```sh
npm install
npm run config:link   # once: link to the app in your Partner account
npm run dev           # runs against a development store
```

Checks (also run in CI on every push):

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

## Renewals

Renewals are charged by `POST /jobs/renewals`, which a scheduler should call
about once an hour with `Authorization: Bearer <RENEWALS_JOB_SECRET>`. The
route answers 404 until `RENEWALS_JOB_SECRET` is set. In development, use
**Members → Run due renewals** or **Renew now** instead.

## Hosting

Production runs at `https://app.biruh.org` as a cPanel Node.js app (Node
22+) with MySQL, on Biruh's shared hosting. Development keeps SQLite.

- `prisma/schema.prisma` is the one schema to edit (SQLite).
  `npm run db:mysql:schema` writes the MySQL copy, `prisma/mysql/schema.prisma`.
  After a schema change, also add a MySQL migration:

  ```sh
  npm run db:mysql:schema
  npx prisma migrate diff \
    --from-schema-datamodel <previous prisma/mysql/schema.prisma from git> \
    --to-schema-datamodel prisma/mysql/schema.prisma \
    --script > prisma/mysql/migrations/<timestamp>_<name>/migration.sql
  ```

- Deploy: commit, then `bash scripts/deploy-live.sh` (uploads the code and
  build, installs, migrates MySQL, restarts). If `shopify.app.toml` or an
  extension changed, also `npm run deploy` (releases the live Shopify app).
- Two Shopify apps: `shopify.app.toml` is the live app (app.biruh.org);
  `shopify.app.dev.toml` is "Biruh Membership (dev)", generated from it by
  `npm run config:dev` and used by `npm run dev`. Edit only
  `shopify.app.toml`.
- Environment variables (set in cPanel's Node.js app, not in files):
  `NODE_ENV=production`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`,
  `SHOPIFY_APP_URL=https://app.biruh.org`, `SCOPES` (same list as
  `shopify.app.toml`), `DATABASE_URL=mysql://user:password@localhost:3306/db`,
  `RENEWALS_JOB_SECRET`, the SMTP settings below, and two the shared host
  needs: `PRISMA_QUERY_ENGINE_LIBRARY` (set to
  `~/biruh-membership-engine/libquery_engine-debian-openssl-1.1.x.so.node`,
  a copy the deploy script refreshes, kept outside node_modules; inside the
  web server Prisma otherwise guesses OpenSSL 1.0) and `APP_LOG_FILE` (Passenger keeps
  no normal output; `server.cjs` appends it there). On the server these live
  in `~/biruh-membership-secrets/env.json` and are applied with
  `cloudlinux-selector set --env-vars`.
- Cron (hourly):
  `curl -fsS -X POST -H "Authorization: Bearer $RENEWALS_JOB_SECRET" https://app.biruh.org/jobs/renewals`

## Email

Member emails (renewal reminder, payment failed, membership ended) go out
over SMTP, the same way PHPMailer does in Moodle. Put these in `.env` (never
committed):

```
SMTP_HOST=mail.biruh.org
SMTP_PORT=465
SMTP_USER=membership@biruh.org
SMTP_PASS=<the mailbox password>
EMAIL_FROM=membership@biruh.org
```

Port 465 uses SSL; 587 uses STARTTLS. Each email shows the store's name as
the sender and replies go to the store's contact email. Without
`SMTP_HOST`, emails are only written to the server log.

## Access scopes

Subscriptions also need `read_customer_payment_methods`,
`read_own_subscription_contracts` and `write_own_subscription_contracts`.
Shopify must approve them first (Partner Dashboard > API access requests);
they go into `shopify.app.toml` only after approval.

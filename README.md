# Membership app (working name)

A Shopify membership app for associations and education organizations:
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

## Access scopes

Subscriptions also need `read_customer_payment_methods`,
`read_own_subscription_contracts` and `write_own_subscription_contracts`.
Shopify must approve them first (Partner Dashboard > API access requests);
they go into `shopify.app.toml` only after approval.

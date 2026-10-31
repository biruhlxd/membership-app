# Changes

## Unreleased

- Admin pages on Shopify's patterns: Home has a setup guide (create a plan,
  get subscription approval, first member) and member counts; Plans is a list
  with a table and an empty state; Create plan is its own page with money and
  number fields, returning to the list with a toast. Removed the template's
  demo home and "Additional page".
- Saving a plan makes its product a membership product: every variant priced
  at the joining price (no fake "saving" on the storefront) and sold only
  through a plan (no one-time purchase). If Shopify refuses, the plan is kept
  and the page says what to change by hand.
- Plan setup in the admin (Plans page): name, customer tag, membership
  product, joining price, renewal price and billing interval. Creates the
  Shopify selling plan group (joining price on the first order, renewal price
  from the second) and saves the plan with its tag. The form checks and the
  selling plan input are tested pure functions. The mutations are validated
  against the 2026-10 schema and need no protected scopes. Tags are unique per
  shop ignoring case; if saving fails after Shopify created the plan, the
  Shopify side is deleted again.
- Membership rules as tested pure functions: renewal prices per cycle
  (joining vs renewal), billing-attempt idempotency keys, failed-payment
  retries (1, 3, 7 days, then lapse), member status and plan tags.
- Database tables for plans, memberships and billing attempts.
- Vitest; CI runs Prisma validation, type check, lint, tests and build,
  started by hand only (Actions minutes). Dependabot removed.
- Added shopify.web.toml (the template only had the uninstantiated .liquid
  file), so `npm run dev` starts the app server and tunnel.
- Removed the template repository's own files (its workflows, changelog,
  README, contributor files); the lockfile is now committed.

## 2026-10-27

- Started from Shopify's React Router app template; project name and first
  access scopes.

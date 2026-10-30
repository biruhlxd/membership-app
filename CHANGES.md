# Changes

## Unreleased

- Membership rules as tested pure functions: renewal prices per cycle
  (joining vs renewal), billing-attempt idempotency keys, failed-payment
  retries (1, 3, 7 days, then lapse), member status and plan tags.
- Database tables for plans, memberships and billing attempts.
- Vitest; CI runs Prisma validation, type check, lint, tests and build,
  started by hand only (Actions minutes). Dependabot removed.
- Removed the template repository's own files (its workflows, changelog,
  README, contributor files); the lockfile is now committed.

## 2026-10-27

- Started from Shopify's React Router app template; project name and first
  access scopes.

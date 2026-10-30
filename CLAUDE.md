@AGENTS.md

# Project notes

A Shopify membership app for associations and education organizations, built
to be sold on the Shopify App Store. Owned personally by Biruh (not by USSEA).
Product plan: https://claude.ai/artifact/WMFWsV3bGbEUoR2KKEdUyi (read it before
starting a phase).

## Product

Four tiers, each a paid layer; a merchant starts with Core:

- **Core:** membership plans on Shopify subscriptions; a first payment priced
  differently from renewals; renewals, failed-payment retries, reminder
  emails; one customer tag per plan, removed when access ends; member pricing
  and members-only products; a member portal in the customer account.
- **Organizations:** seat plans; an organization admin assigns and ends seats
  in the customer account; invites by email; seats pause when the
  organization's plan lapses.
- **Credentials:** credential types with a validity period, requirements per
  credential, an approver queue, renewal blocked or flagged when a credential
  lapses, a public verification page.
- **Integrations:** Moodle first (enrol on join, completion counts toward a
  credential), then other LMSs and SportsEngine; webhooks for the rest.

The app is the membership and billing system. Courses, certificates and
community stay in the organization's learning platform.

## Plan (one full-time developer)

1. Foundations, weeks 1-2: done. Template, Partner account link, CI.
2. Core, weeks 3-10: started. Then gate: apply for Shopify's protected
   subscription access with a working demo store.
3. Organizations, weeks 11-14.
4. Credentials, weeks 15-18.
5. Moodle connector and USSEA pilot, weeks 19-22. Gate: USSEA live, renewals
   charged correctly for a full month.
6. App Store launch, weeks 23-26. Gate: Shopify approves the listing.

## Rules

- **New code only.** Do not copy code from USSEA's repositories or plugins;
  USSEA is a customer like any other.
- **Billing dates come from Shopify.** Each contract's billing cycles are
  numbered from 1 and carry a `billingAttemptExpectedDate`; the scheduler
  reads them and bills the cycles that are due. The app never computes its own
  billing dates.
- **Never charge twice.** Every `subscriptionBillingAttemptCreate` uses
  `billingAttemptKey(contractId, cycleIndex, attempt)` as its idempotency key,
  and the attempt is recorded in `BillingAttempt` (unique key) before the call.
- **Joining vs renewal price** is Shopify's recurring pricing policy
  (`afterCycle: 1` = from the second order on), set on the selling plan; the
  app does not adjust prices at billing time.
- **Tags:** only remove tags that belong to the app's plans; never touch the
  merchant's own tags (`tagChanges` in `app/membership/status.ts`).
- **Rules stay pure.** Membership logic lives in `app/membership/` as pure
  functions with Vitest tests; routes and jobs call Shopify and the database,
  then hand the data to those functions. Money paths get tests first.
- **API version** is 2026-10 in `app/shopify.server.ts`, `.graphqlrc.ts` and
  `shopify.app.toml`; change all three together.
- **Access scopes:** `read_customer_payment_methods`,
  `read_own_subscription_contracts` and `write_own_subscription_contracts`
  go into `shopify.app.toml` only after Shopify approves them; declaring them
  earlier makes Shopify refuse the app version.
- Use the Shopify dev docs (Shopify AI Toolkit / dev MCP) for every Admin API
  call, and validate GraphQL against the schema before using it.

## Working conventions

- Before pushing, run all of: `npm test`, `npm run typecheck`, `npm run lint`,
  `npm run build`, `npx prisma validate`. CI runs the same on every push.
- Record each change in `CHANGES.md` under "Unreleased".
- Commit author email for this repo: biruh@biruh.org (never a USSEA address).
- Plain, short wording in UI text, docs and commit messages.
- Prisma uses SQLite in development; production will be PostgreSQL. Create
  migrations with `npx prisma migrate dev --name <name>`.
- `npm run dev` needs Biruh's Shopify login and a development store; a cloud
  session cannot run it. Leave manual store testing steps for Biruh.

## Next (Core)

1. Plan setup in the admin: create a selling plan group on a membership
   product with a joining price and a renewal price; save `MembershipPlan`
   with its tag.
2. Webhooks: `subscription_contracts/create` and `/update` create and update
   `Membership`; set tags from `membershipStatus` + `tagChanges`.
   Billing-attempt success, failure and action-required webhooks update
   `BillingAttempt` and run `afterFailure` (dunning).
   These topics need the protected scopes, so build them against the docs
   and test them with fixtures until Shopify approves access.
3. Renewal job: find due billing cycles, create billing attempts with the
   idempotency key, schedule retries from `nextAttemptAt`.
4. Mandatory privacy webhooks (customers/data_request, customers/redact,
   shop/redact) before App Store review.
5. Member portal (customer account extension): plan, renew, update card,
   cancel.

Open decisions (Biruh): company and product name; weekly hours available.

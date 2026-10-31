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
  (`afterCycle: 1` = from the second order on), set on the selling plan.
  Shopify does NOT change a contract line's price by itself (learned
  2026-10-31: the first renewal was charged $120 instead of $90). Before
  every charge, `alignPrices` in `renewals.server.ts` sets currentPrice to
  what the cycle owes (`linePriceChanges`), and the charge is skipped if
  that fails.
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
  `npm run build`, `npx prisma validate`. CI (GitHub Actions) runs the same
  checks but only when started by hand, to save Actions minutes; do not turn
  it back on for every push, and do not add Dependabot.
- Record each change in `CHANGES.md` under "Unreleased".
- Commit author email for this repo: biruh@biruh.org (never a USSEA address).
- Plain, short wording in UI text, docs and commit messages.
- Prisma uses SQLite in development and MySQL in production. Edit only
  `prisma/schema.prisma`; create the SQLite migration with
  `npx prisma migrate dev --name <name>`, then `npm run db:mysql:schema` and a
  MySQL migration in `prisma/mysql/migrations` (README "Hosting"). A string
  field that can exceed 191 characters needs adding to LONG_TEXT in
  `scripts/mysql-schema.mjs`.
- `npm run dev` needs Biruh's Shopify login and a development store; a cloud
  session cannot run it. Leave manual store testing steps for Biruh.

## Next (Core)

Status 2026-10-31 (dev store: biruh-tech.myshopify.com):

- Tested on the store: plans (create, edit, list), plan picker theme block,
  memberships + tags from contract webhooks, renewals at the renewal price
  (Renew now), Members page with next renewal and last paid, privacy
  webhooks (via `shopify app webhook trigger`).
- Built, not yet tried on the store: member pricing (segment + automatic
  discount per plan), members-only products (checkout validation function
  `extensions/members-only`, page "Members-only products"), member portal
  (`extensions/member-portal`, merchant must add the page to the customer
  account menu in the checkout and accounts editor), failed-payment retries
  and lapse.

Still to do for Core:
1. Emails: built; sent over SMTP once .env has the biruh.org mailbox
   settings (README "Email").
2. Hosting + a scheduler calling `/jobs/renewals` (Biruh to choose a host).
3. Test a failed payment end to end (needs a declining card on a member).

Then: Organizations, Credentials, Moodle connector, App Store work
(Shopify app billing for the $39/$149/$399 tiers, product-page purchase
options extension, listing), per the plan doc.

Running the dev server: Claude can run `npm run dev` in the background and
read its log. Before a Prisma migration, stop the dev server (its child
processes lock Prisma's engine on Windows), migrate, then restart it.

Shopify setup: the app is in the "Biruh Tech" Partner organization (public
distribution). Subscription scopes are approved. Protected customer data
(name, email) is selected for development only; Shopify's review was refused
because several data protection answers are honestly "No" until the launch
tasks are done (privacy policy, merchant agreement, retention + deletion
webhooks, encrypted database and backups, access logging, incident policy).
Do not change those answers to "Yes" until each is true.

Decided 2026-10-31: product name "Biruh Membership"; company "Biruh Tech"
(unregistered, so use Biruh Alemnew where a legal name is needed); email by
SMTP from a biruh.org mailbox (settings in .env); cancelling keeps access
until the end of the paid period. Hosting: Biruh's shared hosting at
biruh.org is the candidate, to be checked (Node.js support, database, file
limit). Open: weekly hours available.

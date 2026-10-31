# Changes

## Unreleased

- Members-only products: a cart and checkout validation function
  (extensions/members-only) blocks checkout when the cart has a product
  tagged "members-only" and the buyer isn't a logged-in customer with a plan
  tag. The app creates the validation and keeps its list of plan tags (a
  JSON metafield read as input variables) current on every plan save. New
  page "Members-only products" to add and remove products. Function tested
  with `npm test` in the extension (runs fixtures through Shopify's function
  runner). New scopes: read/write_validations.
- Member pricing: a plan can give its members a percent off everything else
  they buy. Saving the plan creates or updates a customer segment of the
  plan's tag and an automatic discount limited to it (never applied to the
  membership itself), so the discount follows membership as tags change.
  Clearing the field removes the discount. New scopes: read/write_discounts.
- Privacy webhooks (customers/data_request, customers/redact, shop/redact):
  data requests are compiled and logged (to be emailed to the merchant
  later); redacts delete the customer's or the shop's memberships, billing
  attempts, plans and sessions. Tested with `shopify app webhook trigger`.
- Members page shows each member's last paid date and next renewal (date
  and amount, the renewal price where it applies); a past-due member's
  retry date shows with their status. The schedule is stored on Membership
  and refreshed from Shopify after every purchase, contract change and
  renewal result; older memberships get it on first view.
- Fix: renewals charged the joining price. Shopify doesn't change a
  contract line's price by itself; before each charge the app now sets the
  line to the price the cycle owes (renewal price from cycle 1) through a
  contract draft, and skips the charge if it can't.
- Saving a plan marks the product's variants as not requiring shipping, so
  membership orders don't wait to be fulfilled.
- Renewals: each due, unbilled Shopify billing cycle is charged with
  subscriptionBillingAttemptCreate and the attempt's idempotency key, saved
  first as a PENDING BillingAttempt. Results come by webhook
  (subscription_billing_attempts/success, failure, challenged); failures
  retry after 1, 3 and 7 days, then the contract is marked failed in Shopify
  and the membership lapses (tag removed). A PENDING attempt with no result
  after a day becomes UNKNOWN. Members page lists members with "Renew now"
  (charges the next unpaid renewal early, billing that cycle directly) and "Run due renewals".
  POST /jobs/renewals runs all shops for a scheduler when
  RENEWALS_JOB_SECRET is set.
- Theme app extension "Membership plan picker": an app block for the product
  page listing the product's plans with joining and renewal prices; the
  chosen plan is sent with Add to cart and Buy it now. Themes without their
  own plan options could not sell a plan-only product without it.
- Memberships follow Shopify's subscription contracts: every
  subscription_contracts/* webhook reads the contract from Shopify, creates
  or updates the Membership, and gives the customer the tag of each plan
  they hold access through (removing the app's other plan tags, never the
  merchant's). A failure returns 500 so Shopify retries.
- Moved the app to the "Biruh Tech" Partner organization (public
  distribution); subscription scopes approved and added.
- Edit a plan: name, tag, joining and renewal price, period (the product is
  fixed). Terms are read from Shopify; after saving, the app reads them back
  and checks Shopify holds exactly the two prices. Changes apply to new
  members only. The tag is locked while the plan has members. Plans now save
  their Shopify group and product ids; older plans find them on first open.
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

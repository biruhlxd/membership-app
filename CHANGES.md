# Changes

## Unreleased

- Order status page: a "Your membership" block with a link to the member
  portal, shown only for orders with a membership line (requirement 5.4.9).

- Membership plans from the Shopify product page (Shopify's subscription
  app requirement 5.4.6): the Purchase options card on a product or variant
  opens a "Membership plan" form (extensions/purchase-options) to create a
  plan or edit one this app made; the app's server does it as the Plans page
  does (/api/purchase-options). A plan made on a variant is offered on that
  variant only and leaves one-time purchase on for the rest (5.4.19).

- Credentials (first version), Credentials page: credential types with a
  code, validity in months (0 = no expiry) and requirements (customer tags
  and/or an active membership plan; Moodle Bridge tags customers
  "completed:<course>" when they finish a course, so completions count).
  Customers who qualify get the credential at once, or wait for an approver
  (queue with Approve / Reject). Issued credentials are numbered
  CODE-YEAR-00001, may expire (checked on every renewal run), can be
  revoked, and while active tag the customer "credential:<code>". A type can
  hold renewals of chosen plans until the member's credential is active
  again, or flag them on the Members page. Public verification page
  /verify/<code> (credential, number, dates, first name and last initial).
  Evaluated on customers/update (new webhook) and on contract changes.
  Credentials are included in the privacy data request and deleted on
  redact. MySQL migration 20261102210000_credentials.

- Organizations (first version): a plan can have up to three seat types
  (name, tag, number of seats); whoever buys it is the organization admin.
  In the member portal the admin sees seats used per type, invites people
  by email into a seat type, and ends seats or withdraws invitations; an
  invited person gets an email, sees the invitation in their portal and
  accepts or declines. An active seat gives the seat type's tag while the
  organization's membership grants access, so seats pause when it lapses
  and return when it renews. Seat tags count as member tags for
  members-only products. The portal reaches the app's server with Shopify's
  session token at the address in the $app.app_url shop metafield; this
  needs Shopify's network access approval for the extension.
- Named: Biruh Membership, by Biruh Tech (Biruh Alemnew). LICENSE.md is now
  proprietary; Shopify's MIT notice for the template moved to
  LICENSE-shopify-template.md.
- Cancelling keeps access until the end of the paid period: the membership
  becomes ENDING (still has the tag and member prices) until the date it
  would have renewed, then the renewal run ends it. Members page shows
  "Ending, access until …"; the member portal says so before and after
  cancelling. Failed payments still end access straight away.
- Emails are sent over SMTP (Nodemailer, configured in .env like PHPMailer
  in Moodle), in the store's name with replies to the store's contact
  email. Without SMTP settings they are still only logged.
- Member emails: a renewal reminder 7 days before each renewal (sent by the
  renewal run), a payment-failed notice with the next retry date, and a
  membership-ended notice when retries run out. Each is sent at most once
  (EmailLog, unique per membership, kind and renewal or attempt). No email
  provider is connected yet: emails are written to the server log and
  recorded as LOGGED; connecting one means replacing `deliver` in
  emails.server.ts. Privacy webhooks now include and delete email records.
- Member portal (extensions/member-portal): a "Membership" page in the
  customer account listing the member's memberships with status, next
  renewal date and price, a link to update the payment card (Shopify's own
  profile page), and cancel with a confirmation step. Uses the Customer
  Account API (new scopes customer_read/write_own_subscription_contracts).
  Cancelling ends access at once for now; see CLAUDE.md open decisions.
- The root type check no longer includes extensions/ (each has its own
  TypeScript setup; mixing their component types broke the admin's types).
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

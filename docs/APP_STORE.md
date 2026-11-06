# App Store listing (draft)

Draft text for the Shopify App Store listing and submission. Check prices
against `app/membership/appPlans.ts` before submitting.

## Review checklist status

Shopify's self-review list (app-store-ai-self-review-requirements) was last
run against this code on 2026-11-06. Fixed that day:

- 2.3.1: `/auth/login` no longer has a shop-domain form.
- 5.1.3: the home page setup guide opens the theme editor with the plan
  picker block added.
- 5.4.9: a welcome email after joining links the Membership page (the order
  status page links it too).
- 5.4.10: the plan picker shows the joining price, the renewal price, how
  often it renews, and "Renews automatically until you cancel."
- 5.4.13: the member portal shows each membership's status, next renewal,
  price and renewal period.
- 5.4.15: the Members page links each membership to its order.

Still to check by hand in a test store before submitting:

- 5.4.14: prices in a second currency (add a market with another currency,
  view the product page in it, buy, check the order).
- 5.4.16: the plan name shows in the cart (Dawn shows it; note any theme
  that doesn't).
- 1.2.2: billing approve, decline, reinstall, and switching plans.

Checked 2026-11-06: 3.1.1, the app.biruh.org certificate is Let's Encrypt
(cPanel AutoSSL renews it) and plain HTTP redirects to HTTPS (a rewrite in
~/app.biruh.org/.htaccess, after the CloudLinux Passenger block). A backup
from that day restored cleanly with the same rows as live.

## Listing

- **Name:** Biruh Membership
- **Tagline:** Memberships with renewals, member pricing and credentials
- **Category:** Selling products › Subscriptions (or Store management ›
  Memberships, if offered)
- **Introduction:** Run paid memberships in Shopify. Members pay a joining
  price, renew automatically at the renewal price, and get member prices and
  members-only products for as long as they stay.
- **Details:**
  - Membership plans with a joining price and a different renewal price,
    renewing every month(s) or year(s). Set up from the app or from the
    product page's Purchase options card.
  - Automatic renewals with reminders a week before, card retries and emails
    when a payment fails, and a clear end when retries run out.
  - Members are tagged in Shopify, so segments, Flow and other apps see who
    is a member. Tags come off when a membership ends.
  - Member prices (a percent off everything) and members-only products,
    checked at checkout.
  - A Membership page in the customer account: status, next renewal, update
    card, cancel. Cancelling keeps access until the paid period ends.
  - Organization plans with seats: the buyer invites people to seats from
    their account (Growth and Association).
  - Credentials: certificates earned through plans or approval, with
    expiry, reminders and a public verification page (Growth and
    Association).
- **Pricing:** Starter $19 / 30 days (up to 100 active members); Growth $59
  / 30 days (up to 1,000 members, organization seats, credentials);
  Association $149 / 30 days (unlimited members, everything). 14-day free
  trial on every plan. Member limits are a guide: the app never stops
  renewals or access for members who already paid.
- **Privacy policy:** `https://app.biruh.org/privacy`
- **Terms:** `https://app.biruh.org/terms`
- **Support:** biruh@biruh.org

## Screenshots to take (1600 × 900)

1. Home page with the setup guide.
2. New plan form (joining price, renewal price, period).
3. Product page in the store with the plan picker block.
4. Members page with statuses, next renewals and order links.
5. The Membership page in a customer account.
6. A credential's public verification page.

## Access scopes and why

- `read_products`, `write_products`: the membership product and its prices.
- `read_purchase_options`, `write_purchase_options`: the membership selling
  plans.
- `read_own_subscription_contracts`, `write_own_subscription_contracts`:
  renewals, cancellations, retries.
- `read_customer_payment_methods`: renewing with the member's saved card.
- `read_customers`, `write_customers`: member tags, names and emails for
  member emails.
- `read_discounts`, `write_discounts`: the member price discount.
- `read_validations`, `write_validations`: the members-only products check
  at checkout.
- `customer_read_own_subscription_contracts`,
  `customer_write_own_subscription_contracts`: the Membership page in the
  customer account (view and cancel).

## For Shopify's reviewers

Testing instructions (draft):

1. Install the app on your development store and open it. Choose any plan
   on the plan page (test charge).
2. Plans › Create plan: pick a product, joining price 120, renewal price 90,
   every 1 year, tag `member`. Save.
3. Home › "Add block in theme editor": the theme editor opens on the product
   template with the "Membership plans" block; click Save.
4. In the store, open the product: the block shows "$120.00 to join, then
   $90.00 every year" and "Renews automatically until you cancel." Buy it
   with the Bogus gateway (card number 1) while signed in as a customer.
5. Members: the customer is listed as Active, with the order linked and the
   next renewal date. The customer has the tag `member`. "Renew now" sends
   a renewal charge straight away.
6. Customer account › Membership: status, next renewal, renewal period,
   update card, cancel. Cancel: the Members page shows "Ending" with the
   date access ends.

Protected customer data: name and email, used for member emails and to show
members to the merchant; email addresses kept by the app are encrypted.

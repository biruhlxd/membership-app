# App Store readiness

Draft listing text, and what Shopify's review checklist
(app-store-ai-self-review-requirements, checked 2026-11-02) still needs.

## Still to do before submitting

- **App billing (1.2.1):** the app charges merchants nothing yet. Either list
  it as free or add Shopify billing (as Moodle Bridge does,
  app/bridge/plans.ts there). Prices to decide.
- **Selling plans from the product page (5.4.6):** subscription apps must let
  merchants create, edit and assign plans from the Shopify product page (a
  purchase options admin extension). Today plans are made on the app's Plans
  page.
- **Portal links (5.4.9):** link to the member portal from the order status
  page and in emails after purchase.
- **Variant-level plans (5.4.19):** plans can be assigned per variant.
- **Needs a check in a test store:** charge timing shown on the product page
  (5.4.10, the plan picker block shows prices), the selling plan name in the
  cart (5.4.16, theme), and currency handling (5.4.14).
- Done 2026-11-02: no shop-domain form on the start page (2.3.1); privacy
  policy at /privacy.

## Listing (draft)

- **Name:** Biruh Membership
- **Tagline:** Memberships with renewals, member pricing and credentials
- **Introduction:** Run memberships on Shopify: a joining price and renewal
  price, automatic renewals with card retries, member prices and
  members-only products, organization seats, and credentials with public
  verification.
- **Privacy policy:** `https://app.biruh.org/privacy`
- **Support:** biruh@biruh.org

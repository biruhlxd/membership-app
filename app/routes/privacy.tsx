// Public privacy policy (/privacy), linked from the App Store listing and the
// start page. Plain HTML: it must load without the Shopify admin.
const UPDATED = "2 November 2026";

const POLICY = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Biruh Membership privacy policy</title>
<style>body{font-family:system-ui,sans-serif;max-width:44rem;margin:3rem auto;padding:0 1rem;line-height:1.55;color:#202223;background:#fff}h1{margin-bottom:.25rem}h2{margin-top:2rem}</style>
</head><body>
<h1>Biruh Membership privacy policy</h1>
<p>Last updated ${UPDATED}. Biruh Membership is a Shopify app made by Biruh Alemnew (Biruh Tech) that runs memberships for a merchant's store on Shopify subscriptions.</p>

<h2>What the app stores</h2>
<ul>
<li><strong>About the store:</strong> the store's address, Shopify's access token for the app, and the store's membership plans, credential types and settings.</li>
<li><strong>About the store's customers:</strong> Shopify customer and subscription IDs, each membership's plan, status and renewal dates, records of renewal charges the app asked Shopify to make, the emails the app sent (address and subject), organization seats and the email addresses invited to them, and credentials (type, number, dates, status, and the holder's first name and last initial for the public verification page).</li>
<li>The app never sees or stores card details. Payments are made in Shopify checkout and renewals are charged by Shopify.</li>
</ul>

<h2>What it is used for, and who receives it</h2>
<p>Only to provide the app's features to the merchant who installed it: renewing memberships, reminder and payment emails to members, member tags and prices, organization seats, credentials, and the member portal. Emails are sent through the operator's email provider. A credential's verification page shows its type, number, dates and the holder's first name and last initial to anyone who has the link the holder shares. Nothing is sold, shared with other parties, or used for advertising.</p>

<h2>How long it is kept</h2>
<p>While the app is installed. Everything about a store is deleted when Shopify sends its shop deletion request (48 hours after uninstalling); a customer's data is deleted when Shopify sends a customer deletion request.</p>

<h2>Where it is kept</h2>
<p>On the app's server, hosted with the operator's web host, over encrypted connections (HTTPS). Email addresses and names are stored encrypted, backups are encrypted, and every read of customer data is logged. See also the <a href="/terms#dpa">data processing agreement</a>.</p>

<h2>Your rights</h2>
<p>Members: ask the store you joined; it can request your data or its deletion through Shopify, and the app answers those requests. Merchants: write to <a href="mailto:biruh@biruh.org">biruh@biruh.org</a>.</p>
</body></html>`;

export const loader = () =>
  new Response(POLICY, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" } });

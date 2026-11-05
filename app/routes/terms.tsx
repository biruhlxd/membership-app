// Public terms of service and data processing agreement (/terms), linked from
// the App Store listing, the privacy policy and the start page. Plain HTML.
// DRAFT for Biruh to review; not legal advice.
const UPDATED = "5 November 2026";
const APP = "Biruh Membership";

const TERMS = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${APP} terms of service</title>
<style>body{font-family:system-ui,sans-serif;max-width:44rem;margin:3rem auto;padding:0 1rem;line-height:1.55;color:#202223;background:#fff}h1{margin-bottom:.25rem}h2{margin-top:2rem}</style>
</head><body>
<h1>${APP} terms of service</h1>
<p>Last updated ${UPDATED}. These terms are between Biruh Alemnew (Biruh Tech), who makes ${APP} ("we"), and the merchant who installs it in a Shopify store ("you").</p>

<h2>1. The service</h2>
<p>${APP} runs memberships for your store on Shopify subscriptions: plans, renewals and retries, member emails, member pricing, members-only products, organization seats, credentials and the member portal, as described in the app. You decide your plans, prices and rules, and you are responsible for what you promise your members.</p>

<h2>2. Charges</h2>
<p>App plans are billed by Shopify, every 30 days, with any free trial shown when you choose a plan. You can change or cancel your plan in the app at any time. Your members' renewals are charged by Shopify to your store, never to us; cancelling your app plan never stops renewals of members who already joined.</p>

<h2>3. Acceptable use</h2>
<p>Use the app only for your own store and lawful purposes, and only with customer data you are allowed to use. Don't try to break, overload or reverse engineer the service.</p>

<h2>4. Availability and changes</h2>
<p>We work to keep the app running and secure but don't promise it will always be available or free of errors. Renewals are charged on Shopify's schedule and safely retried. We may change the app; we will tell you in advance about changes that reduce what your plan includes.</p>

<h2>5. Liability</h2>
<p>To the extent the law allows, the app is provided "as is", and our total liability for any claim is limited to the app charges you paid in the 12 months before it. We are not liable for indirect or consequential losses.</p>

<h2>6. Ending</h2>
<p>You can stop by uninstalling the app. We may suspend the app for a store that breaks these terms. Data is then deleted as set out in the data processing agreement below and the <a href="/privacy">privacy policy</a>.</p>

<h1 id="dpa">Data processing agreement</h1>
<p>This agreement is part of the terms above. For the personal data of your customers that the app handles, you are the controller and we are your processor.</p>

<h2>A. What we process, and why</h2>
<p>Shopify customer and subscription IDs, names and email addresses, membership and renewal records, emails sent, organization seats and invitations, and credentials, only to provide the app's features to you. We process it only on your instructions, which are the app's features and settings.</p>

<h2>B. Our duties</h2>
<ul>
<li>We don't sell the data, use it for advertising, or share it with anyone except our hosting provider (who stores the app's database) and our email provider (who delivers member emails).</li>
<li>Only Biruh Alemnew has access, protected by strong passwords and two-step verification; every access to customer data in the app is logged.</li>
<li>Data is sent over encrypted connections (HTTPS). Email addresses and names stored by the app are encrypted in its database; backups are encrypted.</li>
<li>We keep data only as long as the privacy policy says, and delete it when you uninstall (after Shopify's 48-hour shop deletion request) or when Shopify sends a customer deletion request.</li>
<li>We help you answer your customers' requests to see or delete their data; Shopify passes those requests to the app.</li>
<li>If we become aware of a security incident affecting your customers' data, we tell you and Shopify without undue delay and within 72 hours, with what we know and what we are doing about it.</li>
</ul>

<h2>C. Your duties</h2>
<p>You tell your members how their data is used and have a lawful basis for it.</p>

<h2>Contact</h2>
<p><a href="mailto:biruh@biruh.org">biruh@biruh.org</a></p>
</body></html>`;

export const loader = () =>
  new Response(TERMS, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" } });

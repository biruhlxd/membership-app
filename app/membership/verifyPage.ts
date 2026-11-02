// The public credential verification page (/verify/<code>): anyone with the
// link (on a certificate, an email signature) can check a credential. It shows
// only the holder's first name and last initial, never contact details.

export interface VerifyView {
  shopName: string;
  credential: {
    type: string;
    number: string | null;
    holderName: string;
    status: string;
    issuedAt: Date | null;
    expiresAt: Date | null;
  } | null;
}

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const date = (d: Date | null) =>
  d ? d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : "—";

/** Valid means issued, active and not past its expiry. */
export function verifyState(c: NonNullable<VerifyView["credential"]>, now = new Date()): { valid: boolean; label: string } {
  if (c.status === "ACTIVE" && (!c.expiresAt || c.expiresAt > now)) return { valid: true, label: "Valid" };
  if (c.status === "ACTIVE" || c.status === "EXPIRED") return { valid: false, label: "Expired" };
  if (c.status === "REVOKED") return { valid: false, label: "Revoked" };
  return { valid: false, label: "Not issued" };
}

export function verifyPage(view: VerifyView, now = new Date()): string {
  const c = view.credential;
  const body = !c
    ? `<h1>Credential not found</h1><p>Check the link. Credentials can only be checked with the link the holder shares.</p>`
    : (() => {
        const state = verifyState(c, now);
        return `<p class="issuer">${escape(view.shopName)}</p>
<h1>${escape(c.type)}</h1>
<p class="state ${state.valid ? "valid" : "invalid"}">${state.label}</p>
<dl>
<dt>Holder</dt><dd>${escape(c.holderName)}</dd>
<dt>Number</dt><dd>${escape(c.number ?? "—")}</dd>
<dt>Issued</dt><dd>${date(c.issuedAt)}</dd>
<dt>Expires</dt><dd>${c.expiresAt ? date(c.expiresAt) : "Does not expire"}</dd>
</dl>`;
      })();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Credential check</title>
<style>
body{font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#202223;background:#fff}
.issuer{color:#616161;margin:0}h1{margin:.25rem 0 1rem}
.state{display:inline-block;padding:.25rem .75rem;border-radius:1rem;font-weight:600}
.valid{background:#cdfee1;color:#0c5132}.invalid{background:#fee9e8;color:#8e1f0b}
dl{display:grid;grid-template-columns:max-content 1fr;gap:.5rem 1rem}dt{color:#616161}dd{margin:0}
</style></head><body>${body}</body></html>`;
}

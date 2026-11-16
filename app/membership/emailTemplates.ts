// Merchant-editable emails: the welcome email per plan, the sub-account
// welcome (a seat in an organization, given in Moodle), their {{placeholders}},
// and the layout around them (logo, accent colour, footer). Pure functions: no
// database, no Shopify, no sending (emails.server.ts). Adapted from EdTech
// Bridge's editor (app/bridge/emails.ts there).

export const TEMPLATE_KINDS = ["WELCOME", "SEAT_WELCOME"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export interface Template {
  enabled: boolean;
  subject: string;
  html: string;
}

/** What each placeholder holds. */
export const PLACEHOLDERS = {
  first_name: 'The member\'s first name (or "there")',
  plan_name: "The plan they joined",
  shop_name: "Your store's name",
  renewal_date: 'When it renews, e.g. "November 16, 2027" (empty if unknown)',
  amount: 'What the renewal costs, e.g. "$100.00" (empty if unknown)',
  sign_in_url: "Your store's sign-in page, landing on the page set in Sender & look",
  membership_page_url: "The Membership page in their account (card, renewal, cancel)",
  store_url: "Your online store",
  button_color: "Your button colour, for your own buttons",
  organization_name: "Sub-account welcome only: the organization or school giving the seat",
  seat_type: 'Sub-account welcome only: the seat, e.g. "Instructor"',
} as const;

export type Vars = Record<keyof typeof PLACEHOLDERS, string>;

const button = (href: string, label: string) =>
  `<p><a href="${href}" style="display:inline-block;padding:12px 22px;background:{{button_color}};color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold">${label}</a></p>`;

export const DEFAULTS: Record<TemplateKind, Template & { title: string; when: string }> = {
  WELCOME: {
    title: "Welcome",
    when: "Once, when someone joins this plan. Not on renewals, not for imported members.",
    enabled: true,
    subject: "Welcome to your {{plan_name}}",
    html: [
      "<p>Hi {{first_name}},</p>",
      "<p>Thank you for joining {{shop_name}}. Your <strong>{{plan_name}}</strong> is active.</p>",
      "<p>It renews automatically, and we'll remind you a week before. To see your membership, update your card or cancel, go to the Membership page in your account.</p>",
      button("{{membership_page_url}}", "See your membership"),
      "<p>{{shop_name}}</p>",
    ].join("\n"),
  },
  SEAT_WELCOME: {
    title: "Sub-account welcome",
    when: "When an organization or school gives someone a seat (in Moodle). Once per seat.",
    enabled: true,
    subject: "{{organization_name}} added you to {{shop_name}}",
    html: [
      "<p>Hi {{first_name}},</p>",
      "<p><strong>{{organization_name}}</strong> has given you a {{seat_type}} seat with {{shop_name}}. Your account is ready.</p>",
      "<p>Sign in with this email address to get started.</p>",
      button("{{sign_in_url}}", "Sign in"),
      "<p>{{shop_name}}</p>",
    ].join("\n"),
  },
};

/** Sample values for the preview and the test email. */
export const SAMPLE: Vars = {
  first_name: "Ana",
  plan_name: "Basic Membership",
  shop_name: "Your store",
  renewal_date: "November 16, 2027",
  amount: "$25.00",
  sign_in_url: "https://example.com/customer_authentication/login",
  membership_page_url: "https://shopify.com/account",
  store_url: "https://example.com",
  button_color: "#1a1a1a",
  organization_name: "Riverside Skate School",
  seat_type: "Instructor",
};

/** A shop's sender name and look. Empty fields: the store's own. */
export interface Look {
  senderName: string;
  logoUrl: string;
  accentColor: string;
  buttonColor: string;
  footerHtml: string;
  signInPath: string;
}

export const DEFAULT_LOOK: Look = {
  senderName: "",
  logoUrl: "",
  accentColor: "",
  buttonColor: "#1a1a1a",
  footerHtml: "",
  signInPath: "/account",
};

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Fill {{placeholders}}; unknown ones stay as typed so a typo shows in the preview. */
function fill(text: string, vars: Vars, escape: (v: string) => string): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (whole, name: string) =>
    name in vars ? escape(vars[name as keyof Vars]) : whole,
  );
}

/** Scripts, event handlers and javascript: links never belong in an email. */
export function cleanHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<(iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?(iframe|object|embed)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'\s>]*\2/gi, '$1="#"');
}

/** A plain-text copy of the HTML, for email apps that show text only. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&middot;/g, "·")
    .replace(/&mdash;/g, "—")
    .replace(/&rsquo;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A colour emails can use: #rgb or #rrggbb, else the fallback. */
export function safeColor(color: string, fallback = DEFAULT_LOOK.buttonColor): string {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color.trim()) ? color.trim() : fallback;
}

/** An https image address, else "". */
export function safeLogo(url: string): string {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

/** A path on the store ("/pages/member-portal"), else "/account". */
export function safePath(path: string): string {
  const p = path.trim();
  return /^\/[A-Za-z0-9/_\-.]*$/.test(p) ? p : DEFAULT_LOOK.signInPath;
}

/** The store's login page, sending the customer on to `path` after signing in. */
export function signInUrl(storeUrl: string, path: string): string {
  return `${storeUrl.replace(/\/+$/, "")}/customer_authentication/login?return_to=${encodeURIComponent(safePath(path))}`;
}

/**
 * The email around the merchant's content: an accent stripe and the logo on
 * top (if set), the content, the footer (or the store's name). Tables and
 * inline styles, as email apps need.
 */
export function wrapLayout(content: string, look: Look, shopName: string): string {
  const logo = safeLogo(look.logoUrl);
  const accent = look.accentColor ? safeColor(look.accentColor, "") : "";
  const name = escapeHtml(shopName);
  const footer = look.footerHtml.trim() ? cleanHtml(look.footerHtml) : name;
  return [
    '<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f4">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4"><tr><td align="center" style="padding:24px 12px">',
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:4px${accent ? `;border-top:4px solid ${accent}` : ""}">`,
    logo
      ? `<tr><td align="center" style="padding:28px 32px 0"><img src="${escapeHtml(logo)}" alt="${name}" style="max-height:56px;max-width:220px;display:inline-block;border:0"></td></tr>`
      : "",
    `<tr><td style="padding:28px 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#333333">${content}</td></tr>`,
    `<tr><td style="padding:16px 32px;background:#f0f2f7;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#888888">${footer}</td></tr>`,
    "</table></td></tr></table></body></html>",
  ].join("");
}

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

/** The email for these values: placeholders in the HTML are escaped, the subject is plain text. */
export function render(template: Pick<Template, "subject" | "html">, vars: Vars, look: Look = DEFAULT_LOOK): Rendered {
  const content = cleanHtml(fill(template.html, { ...vars, button_color: safeColor(look.buttonColor) }, escapeHtml));
  const html = wrapLayout(content, look, vars.shop_name);
  return {
    subject: fill(template.subject, vars, (v) => v).replace(/[\r\n]+/g, " ").trim(),
    html,
    text: htmlToText(html),
  };
}

/** Placeholders a template uses that don't exist (a warning when saving). */
export function unknownPlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]))].filter(
    (n) => !(n in PLACEHOLDERS),
  );
}

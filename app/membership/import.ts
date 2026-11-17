// Moving subscribers in from another subscription app (Appstle first) from
// its CSV export. Pure rules: reading the file, guessing which column holds
// what, and checking each row before anything is created in Shopify.
//
// The other app's contracts can't be read through Shopify (an app only sees
// its own), so the export file is the source. Column names differ between
// apps and versions, so the merchant confirms the guessed columns.

export const IMPORT_FIELDS = [
  "sourceId",
  "email",
  "customerId",
  "status",
  "plan",
  "nextBillingDate",
  "price",
  "paymentMethodId",
  "memberSince",
  "lastPaid",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
/** Column index per field; -1 when the file has no such column. */
export type ColumnMap = Record<ImportField, number>;

export const FIELD_LABELS: Record<ImportField, string> = {
  sourceId: "Contract ID",
  email: "Customer email",
  customerId: "Shopify customer ID",
  status: "Status",
  plan: "Plan",
  nextBillingDate: "Next billing date",
  price: "Renewal price",
  paymentMethodId: "Saved card (payment method ID)",
  memberSince: "Member since",
  lastPaid: "Last paid",
};

/** Read a CSV file: quoted fields, doubled quotes, CRLF, a leading BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

// Header patterns per field, most specific first. Matched on the header in
// lower case with anything but letters and digits removed.
const GUESSES: Record<ImportField, RegExp[]> = {
  sourceId: [/^(subscription)?contractid$/, /^subscriptionid$/, /^id$/],
  email: [/^customeremail$/, /^email$/, /email/],
  customerId: [/^shopifycustomerid$/, /^customerid$/],
  status: [/^(subscription|contract)?status$/],
  // Appstle: "Line 0 selling plan name".
  plan: [/^(line\d+)?sellingplanname$/, /^(subscription|selling|membership)?plan(name)?$/, /^producttitle$/, /^product(name)?$/],
  nextBillingDate: [/^next(billing|order|payment|charge)date$/, /^next(billing|order|payment|charge)/],
  // Only a column that says it is the renewal price: a line's price is often
  // the first-year price (Appstle's "Line 0 price amount"), and a delivery
  // price is not the membership's. Without one, the plan's renewal price.
  price: [/^(recurring|renewal)price(amount)?$/, /^(recurring|renewal)amount$/],
  // Appstle: "Payment ID", the customer's saved card the contract charges.
  paymentMethodId: [/^(customer)?paymentmethodid$/, /^paymentid$/],
  // Appstle: "Created at" (the first order), "Last order date" (empty before a renewal).
  memberSince: [/^(member)?since$/, /^createdat$/, /^startdate$/],
  lastPaid: [/^lastpaid(date|at)?$/, /^lastorderdate$/],
};

function key(header: string) {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The column the merchant most likely means for each field. */
export function guessColumns(headers: string[]): ColumnMap {
  const keys = headers.map(key);
  const map = {} as ColumnMap;
  const taken = new Set<number>();
  for (const field of IMPORT_FIELDS) {
    map[field] = -1;
    for (const pattern of GUESSES[field]) {
      const index = keys.findIndex((k, i) => !taken.has(i) && pattern.test(k));
      if (index >= 0) {
        map[field] = index;
        taken.add(index);
        break;
      }
    }
  }
  return map;
}

export interface ImportRow {
  line: number; // line in the file, for the merchant
  sourceId: string;
  email: string | null;
  customerId: string | null; // gid
  plan: string;
  nextBillingDate: string | null; // YYYY-MM-DD
  price: string | null; // decimal, e.g. "100.00"
  /** The saved card the old contract charges, when the file says (gid). */
  paymentMethodId: string | null;
  /** When they joined, and last paid (YYYY-MM-DD), for the Members page. */
  memberSince: string | null;
  lastPaid: string | null;
  /** Why the row will be skipped; empty when it can be imported. */
  problems: string[];
}

/** A date as YYYY-MM-DD: ISO, US (M/D/YYYY) or anything Date can read. */
export function parseDate(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/** A money amount without its currency sign or thousands commas. */
export function parsePrice(value: string): string | null {
  const v = value.replace(/[^0-9.]/g, "");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : null;
}

function customerGid(value: string): string | null {
  const v = value.trim();
  if (/^gid:\/\/shopify\/Customer\/\d+$/.test(v)) return v;
  return /^\d+$/.test(v) ? `gid://shopify/Customer/${v}` : null;
}

/**
 * Check every row. Only active subscriptions are moved; paused and cancelled
 * ones stay where they are. `planOf` maps the file's plan value to one of
 * this app's plans (null when the merchant hasn't matched it).
 */
export function checkRows(
  rows: string[][],
  map: ColumnMap,
  planOf: (plan: string) => string | null,
  today: string, // YYYY-MM-DD
): ImportRow[] {
  const cell = (row: string[], field: ImportField) =>
    map[field] >= 0 ? (row[map[field]] ?? "").trim() : "";
  const seen = new Set<string>();
  const result: ImportRow[] = [];
  rows.forEach((row, i) => {
    const status = cell(row, "status").toLowerCase();
    if (map.status >= 0 && status !== "active") return;
    const problems: string[] = [];
    const sourceId = cell(row, "sourceId");
    const email = cell(row, "email").toLowerCase() || null;
    const customerId = customerGid(cell(row, "customerId"));
    const plan = cell(row, "plan");
    const nextBillingDate = parseDate(cell(row, "nextBillingDate"));
    const priceCell = cell(row, "price");
    const price = priceCell ? parsePrice(priceCell) : null;
    const memberSince = parseDate(cell(row, "memberSince"));
    // Before their first renewal, the joining payment.
    const lastPaid = parseDate(cell(row, "lastPaid")) ?? memberSince;
    const card = cell(row, "paymentMethodId");
    const paymentMethodId = /^gid:\/\/shopify\/CustomerPaymentMethod\/[A-Za-z0-9]+$/.test(card)
      ? card
      : /^[A-Za-z0-9]+$/.test(card)
        ? `gid://shopify/CustomerPaymentMethod/${card}`
        : null;

    if (!sourceId) problems.push("no contract ID");
    else if (seen.has(sourceId)) problems.push("contract ID appears twice in the file");
    seen.add(sourceId);
    if (!customerId && !email) problems.push("no customer email or ID");
    if (!planOf(plan)) problems.push(plan ? `plan "${plan}" not matched` : "no plan");
    if (!nextBillingDate) problems.push("no next billing date");
    else if (nextBillingDate <= today) problems.push("next billing date has passed");
    if (priceCell && !price) problems.push(`price "${priceCell}" not readable`);

    result.push({ line: i + 2, sourceId, email, customerId, plan, nextBillingDate, price, paymentMethodId, memberSince, lastPaid, problems });
  });
  return result;
}

/** The distinct plan values in the file's active rows, for matching. */
export function planValues(rows: string[][], map: ColumnMap): string[] {
  if (map.plan < 0) return [];
  const values = new Set<string>();
  for (const row of rows) {
    if (map.status >= 0 && (row[map.status] ?? "").trim().toLowerCase() !== "active") continue;
    const v = (row[map.plan] ?? "").trim();
    if (v) values.add(v);
  }
  return [...values].sort();
}

// Words every plan name has, which say nothing about which plan it is.
const GENERIC_WORDS = new Set([
  "a", "an", "and", "the", "of", "for", "ussea", "plan", "plans", "membership", "member", "annual", "yearly",
  "monthly", "year", "month", "subscription", "certification", "program", "renewal",
]);

const words = (name: string) =>
  name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !GENERIC_WORDS.has(w));

/**
 * The plan of this app the other app's plan most likely is: the same name, else
 * the one sharing the most telling words ("Annual Instructor Certification" →
 * "USSEA Instructor Membership"). Null when none shares a word, or two tie.
 */
export function suggestPlanId(value: string, plans: { id: string; name: string }[]): string | null {
  const exact = plans.find((p) => p.name.trim().toLowerCase() === value.trim().toLowerCase());
  if (exact) return exact.id;
  const mine = new Set(words(value));
  // Shared words count first; a tie goes to the plan more of whose name matched
  // ("Skateboard Basic": Basic, all of it, over "Skateboard PE School", a third).
  const scored = plans
    .map((p) => {
      const theirs = words(p.name);
      const shared = theirs.filter((w) => mine.has(w)).length;
      return { id: p.id, score: shared === 0 ? 0 : shared + shared / theirs.length };
    })
    .sort((a, b) => b.score - a.score);
  if (!scored[0] || scored[0].score === 0 || scored[1]?.score === scored[0].score) return null;
  return scored[0].id;
}

/**
 * The billing anchor that keeps a moved member on their own renewal day:
 * Shopify counts billing cycles from the day a contract is made unless an
 * anchor says which day of the year (or month) it bills.
 */
export function billingAnchor(
  nextBillingDate: string, // YYYY-MM-DD
  interval: "MONTH" | "YEAR",
): { type: "YEARDAY"; month: number; day: number } | { type: "MONTHDAY"; day: number } {
  const [, month, day] = nextBillingDate.split("-").map(Number);
  return interval === "YEAR" ? { type: "YEARDAY", month, day } : { type: "MONTHDAY", day };
}

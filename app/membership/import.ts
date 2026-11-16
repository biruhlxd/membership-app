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
  plan: [/^sellingplanname$/, /^(subscription|selling|membership)?plan(name)?$/, /^producttitle$/, /^product(name)?$/],
  nextBillingDate: [/^next(billing|order|payment|charge)date$/, /^next(billing|order|payment|charge)/],
  price: [/^(recurring|renewal|line|current)?price$/, /^(recurring|renewal)?amount$/, /price/],
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

    if (!sourceId) problems.push("no contract ID");
    else if (seen.has(sourceId)) problems.push("contract ID appears twice in the file");
    seen.add(sourceId);
    if (!customerId && !email) problems.push("no customer email or ID");
    if (!planOf(plan)) problems.push(plan ? `plan "${plan}" not matched` : "no plan");
    if (!nextBillingDate) problems.push("no next billing date");
    else if (nextBillingDate <= today) problems.push("next billing date has passed");
    if (priceCell && !price) problems.push(`price "${priceCell}" not readable`);

    result.push({ line: i + 2, sourceId, email, customerId, plan, nextBillingDate, price, problems });
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

import { describe, expect, it } from "vitest";
import { checkRows, guessColumns, parseCsv, parseDate, parsePrice, planValues } from "./import";

const BOM = String.fromCharCode(0xfeff);
const CSV = `${BOM}Contract ID,Customer Email,Status,Selling Plan Name,Next Billing Date,Recurring Price\r
101,Ana@Example.com,ACTIVE,"Basic Membership, yearly",2027-01-15T00:00:00Z,$25.00\r
102,ben@example.com,CANCELLED,Coach,2027-02-01,125\r
103,,active,Coach,03/04/2027,"1,125.00"\r
104,cy@example.com,active,Unknown,2026-11-01,25
`;

describe("parseCsv", () => {
  it("reads quotes, CRLF and the BOM", () => {
    const rows = parseCsv(CSV);
    expect(rows[0][0]).toBe("Contract ID");
    expect(rows[1][3]).toBe("Basic Membership, yearly");
    expect(rows[3][5]).toBe("1,125.00");
    expect(rows).toHaveLength(5);
  });

  it("keeps doubled quotes as one", () => {
    expect(parseCsv('a,"say ""hi"""\n')).toEqual([["a", 'say "hi"']]);
  });
});

describe("guessColumns", () => {
  it("finds Appstle-style headers", () => {
    const map = guessColumns(parseCsv(CSV)[0]);
    expect(map).toEqual({ sourceId: 0, email: 1, customerId: -1, status: 2, plan: 3, nextBillingDate: 4, price: 5, paymentMethodId: -1 });
  });

  it("reads Appstle's real export: no price column (first-year price there), the card it charges", () => {
    // Header row of an Appstle subscription export, 2026-11-17.
    const headers = parseCsv(
      "ID,Status,Customer email,Customer name,Customer phone,Delivery first name,Delivery last name,Delivery address 1,Delivery address 2,Delivery province code,Delivery city,Delivery zip,Delivery country code,Delivery phone,Delivery company,Delivery price amount,Delivery price currency,Created at,Updated at,Next order date,Billing interval type,Billing interval count,Billing min cycles,Billing max cycles,Delivery interval type,Delivery interval count,Payment ID,Payment method,Payment method name,Payment method brand,Payment method expiry year,Payment method expiry month,Payment method last digits,Line 0 title,Line 0 SKU,Line 0 quantity,Line 0 price amount,Line 0 price currency,Line 0 product ID,Line 0 variant ID,Line 0 selling plan ID,Line 0 selling plan name,Line 0 Attributes,Cancellation date,Cancellation reason,Paused on date,Total renewals till date,First order name,First order amount,Last order name,Last order date,Last order amount,Discount applied,Billing address,Billing country,Billing country code,Billing city,Billing province code,Billing zip\n",
    )[0];
    const map = guessColumns(headers);
    const name = (field: keyof typeof map) => (map[field] >= 0 ? headers[map[field]] : null);
    expect(name("sourceId")).toBe("ID");
    expect(name("email")).toBe("Customer email");
    expect(name("status")).toBe("Status");
    expect(name("plan")).toBe("Line 0 selling plan name");
    expect(name("nextBillingDate")).toBe("Next order date");
    expect(name("price")).toBeNull();
    expect(name("paymentMethodId")).toBe("Payment ID");

    const row = headers.map(() => "");
    const set = (h: string, v: string) => (row[headers.indexOf(h)] = v);
    set("ID", "171226431542");
    set("Status", "active");
    set("Customer email", "ana@example.com");
    set("Next order date", "2027-10-10T20:00:00Z");
    set("Payment ID", "39fa047175612f60701a094379fda4c0");
    set("Line 0 selling plan name", "Annual Instructor Certification");
    const [checked] = checkRows([row], map, () => "plan-1", "2026-11-17");
    expect(checked).toMatchObject({
      sourceId: "171226431542",
      nextBillingDate: "2027-10-10",
      price: null,
      paymentMethodId: "gid://shopify/CustomerPaymentMethod/39fa047175612f60701a094379fda4c0",
      problems: [],
    });
  });
});

describe("parseDate / parsePrice", () => {
  it("reads ISO and US dates", () => {
    expect(parseDate("2027-01-15T00:00:00Z")).toBe("2027-01-15");
    expect(parseDate("3/4/2027")).toBe("2027-03-04");
    expect(parseDate("soon")).toBeNull();
  });

  it("strips currency signs and commas", () => {
    expect(parsePrice("$1,125.5")).toBe("1125.50");
    expect(parsePrice("free")).toBeNull();
  });
});

describe("checkRows", () => {
  const [headers, ...rows] = parseCsv(CSV);
  const map = guessColumns(headers);
  const planOf = (p: string) => (p === "Unknown" ? null : "plan-1");

  it("takes active rows only and lists each problem", () => {
    const checked = checkRows(rows, map, planOf, "2026-11-16");
    expect(checked.map((r) => r.sourceId)).toEqual(["101", "103", "104"]);
    expect(checked[0]).toMatchObject({ email: "ana@example.com", nextBillingDate: "2027-01-15", price: "25.00", problems: [] });
    expect(checked[1].problems).toEqual(["no customer email or ID"]);
    expect(checked[2].problems).toEqual(['plan "Unknown" not matched', "next billing date has passed"]);
  });

  it("flags a contract listed twice", () => {
    const checked = checkRows([rows[0], rows[0]], map, planOf, "2026-11-16");
    expect(checked[1].problems).toContain("contract ID appears twice in the file");
  });

  it("lists the active rows' plans", () => {
    expect(planValues(rows, map)).toEqual(["Basic Membership, yearly", "Coach", "Unknown"]);
  });
});

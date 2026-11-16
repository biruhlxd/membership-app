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
    expect(map).toEqual({ sourceId: 0, email: 1, customerId: -1, status: 2, plan: 3, nextBillingDate: 4, price: 5 });
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

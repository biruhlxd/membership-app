import { describe, expect, it } from "vitest";
import { DEFAULT_DUNNING } from "./dunning";
import {
  dueCycle,
  linePriceChanges,
  nextUnbilledCycle,
  normalizeErrorCode,
  onChargeFailed,
} from "./renewals";

const now = new Date("2027-11-01T12:00:00Z");
const cycle = (cycleIndex: number, date: string, status = "UNBILLED", skipped = false) => ({
  cycleIndex,
  billingAttemptExpectedDate: date,
  status,
  skipped,
});

describe("dueCycle", () => {
  it("picks the unbilled cycle whose date has come", () => {
    expect(dueCycle([cycle(1, "2027-10-31T12:00:00Z")], now)?.cycleIndex).toBe(1);
  });

  it("waits for a cycle dated in the future", () => {
    expect(dueCycle([cycle(1, "2027-11-02T12:00:00Z")], now)).toBeNull();
  });

  it("skips billed and skipped cycles", () => {
    expect(
      dueCycle(
        [
          cycle(1, "2026-10-31T12:00:00Z", "BILLED"),
          cycle(2, "2027-10-31T12:00:00Z", "UNBILLED", true),
        ],
        now,
      ),
    ).toBeNull();
  });

  it("charges the earliest of several overdue cycles first", () => {
    expect(
      dueCycle(
        [cycle(3, "2027-10-01T00:00:00Z"), cycle(2, "2027-09-01T00:00:00Z")],
        now,
      )?.cycleIndex,
    ).toBe(2);
  });
});

describe("normalizeErrorCode", () => {
  it("upper-cases webhook codes and keeps empty ones empty", () => {
    expect(normalizeErrorCode("card_declined")).toBe("CARD_DECLINED");
    expect(normalizeErrorCode(null)).toBeNull();
  });
});

describe("onChargeFailed", () => {
  it("schedules the first retry a day later and counts the failure", () => {
    expect(onChargeFailed(DEFAULT_DUNNING, 0, "card_declined", now)).toEqual({
      action: "retry",
      failedAttempts: 1,
      nextAttemptAt: new Date("2027-11-02T12:00:00Z"),
      kind: "transient",
    });
  });

  it("says who should act on an expired card", () => {
    expect(onChargeFailed(DEFAULT_DUNNING, 1, "expired_card", now).kind).toBe("member");
  });

  it("lapses after the scheduled charge and three retries fail", () => {
    expect(onChargeFailed(DEFAULT_DUNNING, 3, "card_declined", now)).toEqual({
      action: "lapse",
      failedAttempts: 4,
      kind: "transient",
    });
  });
});

describe("linePriceChanges", () => {
  // As Shopify stores a plan of $120 to join, then $90 after cycle 1.
  const line = (currentPrice: string) => ({
    id: "gid://shopify/SubscriptionLine/1",
    currentPrice: { amount: currentPrice },
    pricingPolicy: {
      basePrice: { amount: "120.0" },
      cycleDiscounts: [{ afterCycle: 1, computedPrice: { amount: "90.0" } }],
    },
  });

  it("drops the price to the renewal price before the first renewal", () => {
    expect(linePriceChanges([line("120.0")], 1)).toEqual([
      { lineId: "gid://shopify/SubscriptionLine/1", price: "90.00" },
    ]);
  });

  it("changes nothing once the line already has the renewal price", () => {
    expect(linePriceChanges([line("90.0")], 2)).toEqual([]);
  });

  it("leaves lines without a pricing policy alone", () => {
    expect(
      linePriceChanges([{ ...line("50.0"), pricingPolicy: null }], 1),
    ).toEqual([]);
  });
});

describe("nextUnbilledCycle", () => {
  it("passes over a billed cycle to the next one, even if it's a year away", () => {
    expect(
      nextUnbilledCycle([
        cycle(1, "2026-10-31T12:00:00Z", "BILLED"),
        cycle(2, "2028-10-31T12:00:00Z"),
      ])?.cycleIndex,
    ).toBe(2);
  });

  it("passes over skipped cycles", () => {
    expect(
      nextUnbilledCycle([
        cycle(2, "2028-10-31T12:00:00Z", "UNBILLED", true),
        cycle(3, "2029-10-31T12:00:00Z"),
      ])?.cycleIndex,
    ).toBe(3);
  });
});

import { describe, expect, it } from "vitest";
import { billingAttemptKey, priceForOrder } from "./billing";

describe("priceForOrder", () => {
  // $120 to join, $90 for every renewal.
  const joining = { base: 120, policies: [{ afterCycle: 1, amount: 90 }] };

  it("charges the base price for the checkout order", () => {
    expect(priceForOrder(joining.base, joining.policies, 0)).toBe(120);
  });

  it("charges the renewal price from the second order on", () => {
    expect(priceForOrder(joining.base, joining.policies, 1)).toBe(90);
    expect(priceForOrder(joining.base, joining.policies, 7)).toBe(90);
  });

  it("uses the latest policy reached, whatever their order", () => {
    // Intro year at $60, then $100, then $80 for loyal members from year 4.
    const policies = [
      { afterCycle: 3, amount: 80 },
      { afterCycle: 1, amount: 100 },
    ];
    expect(priceForOrder(60, policies, 0)).toBe(60);
    expect(priceForOrder(60, policies, 2)).toBe(100);
    expect(priceForOrder(60, policies, 3)).toBe(80);
  });

  it("keeps one price when there are no policies", () => {
    expect(priceForOrder(50, [], 5)).toBe(50);
  });
});

describe("billingAttemptKey", () => {
  const contract = "gid://shopify/SubscriptionContract/123456";

  it("is the same for the same contract, cycle and attempt", () => {
    expect(billingAttemptKey(contract, 2, 1)).toBe(
      billingAttemptKey(contract, 2, 1),
    );
  });

  it("differs between cycles and between attempts", () => {
    const keys = new Set([
      billingAttemptKey(contract, 2, 1),
      billingAttemptKey(contract, 2, 2),
      billingAttemptKey(contract, 3, 1),
    ]);
    expect(keys.size).toBe(3);
  });

  it("uses the numeric contract id", () => {
    expect(billingAttemptKey(contract, 2, 1)).toBe(
      "membership-123456-cycle-2-attempt-1",
    );
  });

  it("refuses cycle 0 and attempt 0", () => {
    expect(() => billingAttemptKey(contract, 0, 1)).toThrow(RangeError);
    expect(() => billingAttemptKey(contract, 1, 0)).toThrow(RangeError);
  });
});

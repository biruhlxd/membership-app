import { describe, expect, it } from "vitest";
import { DEFAULT_DUNNING } from "./dunning";
import { dueCycle, normalizeErrorCode, onChargeFailed } from "./renewals";

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

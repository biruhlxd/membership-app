import { describe, expect, it } from "vitest";
import { afterFailure, classifyFailure, DEFAULT_DUNNING } from "./dunning";

describe("classifyFailure", () => {
  it("asks the member to act on card problems", () => {
    expect(classifyFailure("EXPIRED_CARD")).toBe("member");
    expect(classifyFailure("PAYMENT_METHOD_NOT_FOUND")).toBe("member");
    expect(classifyFailure("AUTHENTICATION_REQUIRED")).toBe("member");
  });

  it("asks the merchant to act on store setup problems", () => {
    expect(classifyFailure("PAYMENT_PROVIDER_IS_NOT_ENABLED")).toBe("merchant");
    expect(classifyFailure("INSUFFICIENT_INVENTORY")).toBe("merchant");
  });

  it("retries declines and unknown errors as they are", () => {
    expect(classifyFailure("CARD_DECLINED")).toBe("transient");
    expect(classifyFailure("INSUFFICIENT_FUNDS")).toBe("transient");
    expect(classifyFailure("SOMETHING_NEW")).toBe("transient");
    expect(classifyFailure(null)).toBe("transient");
  });
});

describe("afterFailure", () => {
  const failedAt = new Date("2026-11-01T09:00:00Z");

  it("retries 1, 3 and 7 days after each failure by default", () => {
    expect(afterFailure(DEFAULT_DUNNING, 1, failedAt)).toEqual({
      action: "retry",
      attempt: 2,
      at: new Date("2026-11-02T09:00:00Z"),
    });
    expect(afterFailure(DEFAULT_DUNNING, 2, failedAt)).toEqual({
      action: "retry",
      attempt: 3,
      at: new Date("2026-11-04T09:00:00Z"),
    });
    expect(afterFailure(DEFAULT_DUNNING, 3, failedAt)).toEqual({
      action: "retry",
      attempt: 4,
      at: new Date("2026-11-08T09:00:00Z"),
    });
  });

  it("lapses once the retries run out", () => {
    expect(afterFailure(DEFAULT_DUNNING, 4, failedAt)).toEqual({
      action: "lapse",
    });
  });

  it("lapses at once when the policy has no retries", () => {
    expect(afterFailure({ retryAfterDays: [] }, 1, failedAt)).toEqual({
      action: "lapse",
    });
  });

  it("refuses attempt 0", () => {
    expect(() => afterFailure(DEFAULT_DUNNING, 0, failedAt)).toThrow(RangeError);
  });
});

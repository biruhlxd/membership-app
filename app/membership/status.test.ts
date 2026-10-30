import { describe, expect, it } from "vitest";
import { grantsAccess, membershipStatus, tagChanges } from "./status";

describe("membershipStatus", () => {
  const paid = { failedAttempts: 0, dunningExhausted: false };

  it("is active when the contract is active and paid", () => {
    expect(membershipStatus({ contractStatus: "ACTIVE", ...paid })).toBe(
      "ACTIVE",
    );
  });

  it("is past due while retries run", () => {
    expect(
      membershipStatus({
        contractStatus: "ACTIVE",
        failedAttempts: 2,
        dunningExhausted: false,
      }),
    ).toBe("PAST_DUE");
  });

  it("lapses when retries run out or the contract fails or expires", () => {
    expect(
      membershipStatus({
        contractStatus: "ACTIVE",
        failedAttempts: 4,
        dunningExhausted: true,
      }),
    ).toBe("LAPSED");
    expect(membershipStatus({ contractStatus: "FAILED", ...paid })).toBe(
      "LAPSED",
    );
    expect(membershipStatus({ contractStatus: "EXPIRED", ...paid })).toBe(
      "LAPSED",
    );
  });

  it("follows a paused or cancelled contract", () => {
    expect(membershipStatus({ contractStatus: "PAUSED", ...paid })).toBe(
      "PAUSED",
    );
    expect(membershipStatus({ contractStatus: "CANCELLED", ...paid })).toBe(
      "CANCELLED",
    );
  });
});

describe("grantsAccess", () => {
  it("keeps access while active or past due only", () => {
    expect(grantsAccess("ACTIVE")).toBe(true);
    expect(grantsAccess("PAST_DUE")).toBe(true);
    expect(grantsAccess("PAUSED")).toBe(false);
    expect(grantsAccess("LAPSED")).toBe(false);
    expect(grantsAccess("CANCELLED")).toBe(false);
  });
});

describe("tagChanges", () => {
  const planTags = ["member-basic", "member-coach", "member-instructor"];

  it("adds the plan tag to a new member", () => {
    expect(tagChanges(["vip"], planTags, "member-coach")).toEqual({
      add: ["member-coach"],
      remove: [],
    });
  });

  it("swaps the old plan tag on an upgrade", () => {
    expect(
      tagChanges(["member-basic", "vip"], planTags, "member-coach"),
    ).toEqual({ add: ["member-coach"], remove: ["member-basic"] });
  });

  it("removes every plan tag when access ends, and keeps the merchant's tags", () => {
    expect(
      tagChanges(["member-coach", "vip", "newsletter"], planTags, null),
    ).toEqual({ add: [], remove: ["member-coach"] });
  });

  it("changes nothing when the tags are already right, whatever the case", () => {
    expect(tagChanges(["Member-Coach"], planTags, "member-coach")).toEqual({
      add: [],
      remove: [],
    });
  });

  it("refuses a tag that is not a plan tag", () => {
    expect(() => tagChanges([], planTags, "vip")).toThrow();
  });
});

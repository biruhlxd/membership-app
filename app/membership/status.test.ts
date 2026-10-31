import { describe, expect, it } from "vitest";
import {
  accessEndsAt,
  desiredTags,
  grantsAccess,
  membershipStatus,
  tagChanges,
} from "./status";

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
    expect(tagChanges(["vip"], planTags, ["member-coach"])).toEqual({
      add: ["member-coach"],
      remove: [],
    });
  });

  it("swaps the old plan tag on an upgrade", () => {
    expect(
      tagChanges(["member-basic", "vip"], planTags, ["member-coach"]),
    ).toEqual({ add: ["member-coach"], remove: ["member-basic"] });
  });

  it("removes every plan tag when access ends, and keeps the merchant's tags", () => {
    expect(
      tagChanges(["member-coach", "vip", "newsletter"], planTags, []),
    ).toEqual({ add: [], remove: ["member-coach"] });
  });

  it("changes nothing when the tags are already right, whatever the case", () => {
    expect(tagChanges(["Member-Coach"], planTags, ["member-coach"])).toEqual({
      add: [],
      remove: [],
    });
  });

  it("refuses a tag that is not a plan tag", () => {
    expect(() => tagChanges([], planTags, ["vip"])).toThrow();
  });
});

describe("tagChanges with several plans", () => {
  const planTags = ["member-coach", "member-instructor"];

  it("keeps one tag and adds the other for a member of two plans", () => {
    expect(
      tagChanges(["member-coach"], planTags, ["member-coach", "member-instructor"]),
    ).toEqual({ add: ["member-instructor"], remove: [] });
  });
});

describe("desiredTags", () => {
  it("gives the tag of every plan that grants access, once each", () => {
    expect(
      desiredTags([
        { status: "ACTIVE", tag: "member-coach" },
        { status: "PAST_DUE", tag: "member-instructor" },
        { status: "ACTIVE", tag: "Member-Coach" },
      ]),
    ).toEqual(["Member-Coach", "member-instructor"]);
  });

  it("gives no tag for lapsed, paused or cancelled memberships", () => {
    expect(
      desiredTags([
        { status: "LAPSED", tag: "member-coach" },
        { status: "PAUSED", tag: "member-instructor" },
        { status: "CANCELLED", tag: "member-basic" },
      ]),
    ).toEqual([]);
  });
});

describe("cancelling at the end of the paid period", () => {
  const now = new Date("2027-01-15T00:00:00Z");
  const cancelled = { contractStatus: "CANCELLED" as const, failedAttempts: 0, dunningExhausted: false, now };

  it("keeps a cancelled member ENDING, with access, until the paid period ends", () => {
    const status = membershipStatus({ ...cancelled, accessEndsAt: new Date("2027-10-31T16:00:00Z") });
    expect(status).toBe("ENDING");
    expect(grantsAccess(status)).toBe(true);
  });

  it("ends access once that date has passed, or when nothing was paid ahead", () => {
    expect(membershipStatus({ ...cancelled, accessEndsAt: new Date("2027-01-01T00:00:00Z") })).toBe("CANCELLED");
    expect(membershipStatus({ ...cancelled, accessEndsAt: null })).toBe("CANCELLED");
    expect(grantsAccess("CANCELLED")).toBe(false);
  });

  it("takes the next renewal date as the end of access, if it is still ahead", () => {
    expect(accessEndsAt(new Date("2027-10-31T16:00:00Z"), now)).toEqual(new Date("2027-10-31T16:00:00Z"));
    expect(accessEndsAt(new Date("2026-10-31T16:00:00Z"), now)).toBeNull();
    expect(accessEndsAt(null, now)).toBeNull();
  });
});

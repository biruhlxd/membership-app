import { describe, expect, it } from "vitest";
import {
  credentialNumber,
  credentialTag,
  expiresAt,
  parseTypeForm,
  publicName,
  renewalDecision,
  requirementsFromJson,
  requirementsMet,
  requirementsToJson,
} from "./credentials";

describe("credential type form", () => {
  it("reads a valid form", () => {
    const result = parseTypeForm({
      name: "Coach Level 1",
      code: "coach1",
      validityMonths: "24",
      tags: "Completed:COACH101, safe-sport",
      planIds: ["plan_a"],
      needsApproval: "on",
      renewalRule: "block",
      renewalPlanIds: "plan_a",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        name: "Coach Level 1",
        code: "COACH1",
        validityMonths: 24,
        requirements: [
          { kind: "tag", tag: "completed:coach101" },
          { kind: "tag", tag: "safe-sport" },
          { kind: "plan", planId: "plan_a" },
        ],
        needsApproval: true,
        renewalRule: "block",
        renewalPlanIds: ["plan_a"],
      },
    });
  });

  it("explains what is wrong", () => {
    const result = parseTypeForm({ name: "", code: "x", validityMonths: "-1", renewalRule: "flag" });
    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(
      ["code", "name", "renewalPlanIds", "requirements", "validityMonths"].sort(),
    );
  });

  it("drops renewal plans when renewals aren't checked", () => {
    const result = parseTypeForm({ name: "A", code: "AB", tags: "x", renewalRule: "none", renewalPlanIds: "p" });
    expect(result.ok && result.value.renewalPlanIds).toEqual([]);
  });
});

describe("requirements", () => {
  const requirements = [
    { kind: "tag" as const, tag: "completed:coach101" },
    { kind: "plan" as const, planId: "p1" },
  ];

  it("needs every requirement, tags ignoring case", () => {
    expect(requirementsMet(requirements, { tags: ["Completed:COACH101"], planIds: ["p1"] })).toBe(true);
    expect(requirementsMet(requirements, { tags: ["completed:coach101"], planIds: [] })).toBe(false);
    expect(requirementsMet([], { tags: ["x"], planIds: ["p1"] })).toBe(false);
  });

  it("round-trips through JSON and ignores junk", () => {
    expect(requirementsFromJson(requirementsToJson(requirements))).toEqual(requirements);
    expect(requirementsFromJson('[{"kind":"tag"},{"kind":"plan","planId":"p"}]')).toEqual([{ kind: "plan", planId: "p" }]);
    expect(requirementsFromJson("not json")).toEqual([]);
  });
});

describe("issuing", () => {
  it("numbers credentials", () => {
    expect(credentialNumber("COACH1", 2026, 7)).toBe("COACH1-2026-00007");
  });

  it("expires the same day months later, or at month end", () => {
    expect(expiresAt(new Date("2026-01-15T10:00:00Z"), 24)?.toISOString()).toBe("2028-01-15T10:00:00.000Z");
    expect(expiresAt(new Date("2026-01-31T00:00:00Z"), 1)?.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(expiresAt(new Date("2026-01-31T00:00:00Z"), 0)).toBeNull();
  });

  it("tags and names", () => {
    expect(credentialTag("COACH1")).toBe("credential:coach1");
    expect(publicName("Ana", "bekele")).toBe("Ana B.");
    expect(publicName("", "")).toBe("Member");
  });
});

describe("renewals", () => {
  it("charges with an active credential or no rule, else flags or blocks", () => {
    expect(renewalDecision("block", true)).toBe("charge");
    expect(renewalDecision("none", false)).toBe("charge");
    expect(renewalDecision("flag", false)).toBe("flag");
    expect(renewalDecision("block", false)).toBe("block");
  });
});

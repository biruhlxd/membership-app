import { describe, expect, it } from "vitest";
import { verifyPage, verifyState } from "./verifyPage";

const now = new Date("2026-11-02T00:00:00Z");
const credential = {
  type: "Coach Level 1",
  number: "COACH1-2026-00001",
  holderName: "Ana B.",
  status: "ACTIVE",
  issuedAt: new Date("2026-01-15T00:00:00Z"),
  expiresAt: new Date("2028-01-15T00:00:00Z"),
};

describe("verification state", () => {
  it("is valid only while active and in date", () => {
    expect(verifyState(credential, now)).toEqual({ valid: true, label: "Valid" });
    expect(verifyState({ ...credential, expiresAt: new Date("2026-10-01T00:00:00Z") }, now).label).toBe("Expired");
    expect(verifyState({ ...credential, status: "EXPIRED" }, now).label).toBe("Expired");
    expect(verifyState({ ...credential, status: "REVOKED" }, now).label).toBe("Revoked");
    expect(verifyState({ ...credential, status: "PENDING" }, now).label).toBe("Not issued");
    expect(verifyState({ ...credential, expiresAt: null }, now).valid).toBe(true);
  });
});

describe("verification page", () => {
  it("shows the credential and nothing personal beyond the short name", () => {
    const html = verifyPage({ shopName: "USSEA", credential }, now);
    expect(html).toContain("Coach Level 1");
    expect(html).toContain("COACH1-2026-00001");
    expect(html).toContain("Ana B.");
    expect(html).toContain('class="state valid"');
    expect(html).toContain('content="noindex"');
  });

  it("escapes text and handles a missing credential", () => {
    expect(verifyPage({ shopName: "<b>x</b>", credential }, now)).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(verifyPage({ shopName: "x", credential: null }, now)).toContain("Credential not found");
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import { emailHash, isSealed, openField, sealField } from "./dataCrypto.server";

describe("personal data at rest", () => {
  beforeAll(() => {
    process.env.DATA_KEY = "d".repeat(64);
  });

  it("stores fields encrypted and reads them back", () => {
    const sealed = sealField("ana@example.com");
    expect(sealed).not.toContain("ana");
    expect(isSealed(sealed)).toBe(true);
    expect(openField(sealed)).toBe("ana@example.com");
    expect(sealField("same")).not.toBe(sealField("same"));
  });

  it("keeps empty values and reads values saved before encryption", () => {
    expect(sealField("")).toBe("");
    expect(openField(null)).toBe("");
    expect(openField("Ana B.")).toBe("Ana B.");
  });

  it("hashes emails the same way whatever the case, without revealing them", () => {
    expect(emailHash(" Ana@Example.com ")).toBe(emailHash("ana@example.com"));
    expect(emailHash("ana@example.com")).not.toContain("ana");
    expect(emailHash("ana@example.com")).not.toBe(emailHash("ben@example.com"));
  });
});

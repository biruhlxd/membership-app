import { describe, expect, it } from "vitest";
import {
  checkInvite,
  managedTags,
  parseSeatTypes,
  seatTypesFromJson,
  seatTypesToJson,
  seatUsage,
} from "./organizations";

const coach = { name: "Coach", tag: "member-coach", seats: 2 };
const instructor = { name: "Instructor", tag: "member-instructor", seats: 1 };

describe("parseSeatTypes", () => {
  it("reads filled rows and skips empty ones", () => {
    expect(
      parseSeatTypes([
        { name: "Coach", tag: "member-coach", seats: "10" },
        { name: "", tag: "", seats: "" },
      ]),
    ).toEqual({ ok: true, seatTypes: [{ name: "Coach", tag: "member-coach", seats: 10 }] });
  });

  it("gives no seat types for a plain plan", () => {
    expect(parseSeatTypes([{ name: "", tag: "", seats: "" }])).toEqual({ ok: true, seatTypes: [] });
  });

  it("refuses half-filled rows, bad counts and repeated tags", () => {
    expect(parseSeatTypes([{ name: "Coach", tag: "", seats: "10" }]).ok).toBe(false);
    expect(parseSeatTypes([{ name: "Coach", tag: "member-coach", seats: "0" }]).ok).toBe(false);
    expect(parseSeatTypes([{ name: "Coach", tag: "member-coach", seats: "2.5" }]).ok).toBe(false);
    expect(
      parseSeatTypes([
        { name: "Coach", tag: "member-coach", seats: "1" },
        { name: "Head coach", tag: "Member-Coach", seats: "1" },
      ]).ok,
    ).toBe(false);
  });
});

describe("seat types JSON", () => {
  it("round-trips, and stores nothing for a plain plan", () => {
    expect(seatTypesFromJson(seatTypesToJson([coach]))).toEqual([coach]);
    expect(seatTypesToJson([])).toBeNull();
  });

  it("treats missing or broken JSON as no seat types", () => {
    expect(seatTypesFromJson(null)).toEqual([]);
    expect(seatTypesFromJson("not json")).toEqual([]);
  });
});

describe("seatUsage", () => {
  it("counts invited and active seats, not ended ones", () => {
    const usage = seatUsage(
      [coach, instructor],
      [
        { tag: "member-coach", status: "ACTIVE" },
        { tag: "member-coach", status: "ENDED" },
        { tag: "member-instructor", status: "INVITED" },
      ],
    );
    expect(usage.map((u) => [u.tag, u.used, u.left])).toEqual([
      ["member-coach", 1, 1],
      ["member-instructor", 1, 0],
    ]);
  });
});

describe("checkInvite", () => {
  const seats = [
    { tag: "member-coach", status: "ACTIVE" as const, email: "ana@example.com" },
    { tag: "member-instructor", status: "INVITED" as const, email: "ben@example.com" },
  ];

  it("allows an invite into a seat type with seats left", () => {
    const result = checkInvite([coach, instructor], seats, " Cara@Example.com ", "member-coach");
    expect(result.ok && result.seatType.name).toBe("Coach");
  });

  it("refuses a full seat type, a repeat invite and a bad address", () => {
    expect(checkInvite([coach, instructor], seats, "dan@example.com", "member-instructor").ok).toBe(false);
    expect(checkInvite([coach, instructor], seats, "ANA@example.com", "member-coach").ok).toBe(false);
    expect(checkInvite([coach, instructor], seats, "not-an-email", "member-coach").ok).toBe(false);
    expect(checkInvite([coach, instructor], seats, "eve@example.com", "member-unknown").ok).toBe(false);
  });

  it("lets someone be invited again after their seat ended", () => {
    const ended = [{ tag: "member-coach", status: "ENDED" as const, email: "ana@example.com" }];
    expect(checkInvite([coach], ended, "ana@example.com", "member-coach").ok).toBe(true);
  });
});

describe("managedTags", () => {
  it("includes every plan tag and every seat tag, once", () => {
    expect(
      managedTags([
        { tag: "org-club", seatTypes: seatTypesToJson([coach, instructor]) },
        { tag: "member-coach", seatTypes: null },
      ]),
    ).toEqual(["org-club", "member-coach", "member-instructor"]);
  });
});

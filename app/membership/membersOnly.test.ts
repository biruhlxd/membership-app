import { describe, expect, it } from "vitest";
import { membersOnlyConfig } from "./membersOnly";

describe("membersOnlyConfig", () => {
  it("lists every plan tag once, under the function's variable name", () => {
    expect(JSON.parse(membersOnlyConfig(["member-coach", "Member-Coach", "member-pe"]))).toEqual({
      memberTags: ["member-coach", "member-pe"],
    });
  });

  it("gives an empty list when the shop has no plans, so no one counts as a member", () => {
    expect(JSON.parse(membersOnlyConfig([]))).toEqual({ memberTags: [] });
  });
});

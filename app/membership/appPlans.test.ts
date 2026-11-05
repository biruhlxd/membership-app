import { describe, expect, it } from "vitest";
import { appFeaturesOf, appPlanFromSubscriptions, ASSOCIATION, GROWTH, overMemberLimit, STARTER } from "./appPlans";

describe("app plans", () => {
  it("gives each plan its features; no plan allows no new setup", () => {
    expect(appFeaturesOf("None").plans).toBe(false);
    expect(appFeaturesOf(STARTER)).toMatchObject({ plans: true, members: 100, organizations: false, credentials: false });
    expect(appFeaturesOf(GROWTH)).toMatchObject({ organizations: true, credentials: true, members: 1000 });
    expect(appFeaturesOf(ASSOCIATION).members).toBe(Infinity);
    expect(appFeaturesOf("something")).toEqual(appFeaturesOf("None"));
  });

  it("picks the best active subscription", () => {
    expect(appPlanFromSubscriptions([])).toBe("None");
    expect(appPlanFromSubscriptions([{ name: STARTER }, { name: GROWTH, status: "ACTIVE" }])).toBe(GROWTH);
    expect(appPlanFromSubscriptions([{ name: ASSOCIATION, status: "CANCELLED" }, { name: STARTER }])).toBe(STARTER);
  });

  it("warns above the member limit", () => {
    expect(overMemberLimit(STARTER, 100)).toBe(false);
    expect(overMemberLimit(STARTER, 101)).toBe(true);
    expect(overMemberLimit(ASSOCIATION, 1_000_000)).toBe(false);
    expect(overMemberLimit("None", 5)).toBe(false);
  });
});

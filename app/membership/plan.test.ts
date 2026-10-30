import { describe, expect, it } from "vitest";
import { parsePlanForm, sellingPlanGroupInput } from "./plan";

const form = {
  name: "Annual membership",
  tag: "member-annual",
  productId: "gid://shopify/Product/1",
  joiningPrice: "120.00",
  renewalPrice: "90",
  interval: "YEAR",
  intervalCount: "1",
};

describe("parsePlanForm", () => {
  it("accepts a complete form", () => {
    const result = parsePlanForm(form);
    expect(result).toEqual({
      ok: true,
      plan: {
        name: "Annual membership",
        tag: "member-annual",
        productId: "gid://shopify/Product/1",
        joiningPrice: 120,
        renewalPrice: 90,
        interval: "YEAR",
        intervalCount: 1,
      },
    });
  });

  it("trims the name and tag", () => {
    const result = parsePlanForm({ ...form, name: "  Gold ", tag: " gold " });
    expect(result.ok && [result.plan.name, result.plan.tag]).toEqual([
      "Gold",
      "gold",
    ]);
  });

  it("reports every problem at once", () => {
    const result = parsePlanForm({
      name: "",
      tag: "a,b",
      productId: "",
      joiningPrice: "-1",
      renewalPrice: "abc",
      interval: "WEEK",
      intervalCount: "0",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual([
        "interval",
        "intervalCount",
        "joiningPrice",
        "name",
        "productId",
        "renewalPrice",
        "tag",
      ]);
    }
  });

  it("allows a free joining or renewal price", () => {
    expect(parsePlanForm({ ...form, joiningPrice: "0" }).ok).toBe(true);
    expect(parsePlanForm({ ...form, renewalPrice: "0" }).ok).toBe(true);
  });

  it("rejects prices with more than two decimals", () => {
    const result = parsePlanForm({ ...form, joiningPrice: "10.999" });
    expect(!result.ok && result.errors.joiningPrice).toBeDefined();
  });

  it("rejects a product that is not a Shopify product id", () => {
    const result = parsePlanForm({ ...form, productId: "gid://shopify/Order/1" });
    expect(!result.ok && result.errors.productId).toBeDefined();
  });
});

describe("sellingPlanGroupInput", () => {
  const parsed = parsePlanForm(form);
  if (!parsed.ok) throw new Error("fixture must be valid");
  const input = sellingPlanGroupInput(parsed.plan);
  const plan = input.sellingPlansToCreate[0];

  it("names the group and its single option after the plan", () => {
    expect(input.name).toBe("Annual membership");
    expect(input.options).toEqual(["Membership"]);
    expect(plan.options).toEqual(["Annual membership"]);
  });

  it("bills and renews on the chosen interval", () => {
    const policy = { recurring: { interval: "YEAR", intervalCount: 1 } };
    expect(plan.billingPolicy.recurring).toMatchObject(policy.recurring);
    expect(plan.deliveryPolicy.recurring).toMatchObject(policy.recurring);
  });

  it("sets the joining price on the first order and the renewal price after cycle 1", () => {
    expect(plan.pricingPolicies).toEqual([
      {
        fixed: {
          adjustmentType: "PRICE",
          adjustmentValue: { fixedValue: "120.00" },
        },
      },
      {
        recurring: {
          adjustmentType: "PRICE",
          adjustmentValue: { fixedValue: "90.00" },
          afterCycle: 1,
        },
      },
    ]);
  });

  it("does not stop after a number of cycles", () => {
    expect(plan.billingPolicy.recurring).not.toHaveProperty("maxCycles");
  });
});

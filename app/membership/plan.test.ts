import { describe, expect, it } from "vitest";
import {
  parsePlanForm,
  planFromShopify,
  sameTerms,
  sellingPlanGroupInput,
  sellingPlanGroupUpdateInput,
  variantPriceInputs,
} from "./plan";

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

describe("variantPriceInputs", () => {
  it("prices every variant at the joining price, with two decimals", () => {
    expect(
      variantPriceInputs(
        ["gid://shopify/ProductVariant/1", "gid://shopify/ProductVariant/2"],
        120,
      ),
    ).toEqual([
      { id: "gid://shopify/ProductVariant/1", price: "120.00" },
      { id: "gid://shopify/ProductVariant/2", price: "120.00" },
    ]);
  });

  it("gives nothing for a product with no variants", () => {
    expect(variantPriceInputs([], 120)).toEqual([]);
  });
});

describe("sellingPlanGroupUpdateInput", () => {
  const plan = {
    name: "Coach membership",
    tag: "member-coach",
    productId: "gid://shopify/Product/1",
    joiningPrice: 150,
    renewalPrice: 100,
    interval: "YEAR" as const,
    intervalCount: 1,
  };
  const input = sellingPlanGroupUpdateInput(plan, "gid://shopify/SellingPlan/9");

  it("updates the existing selling plan by id, creating none", () => {
    expect(input.sellingPlansToUpdate).toHaveLength(1);
    expect(input.sellingPlansToUpdate[0].id).toBe("gid://shopify/SellingPlan/9");
    expect(input).not.toHaveProperty("sellingPlansToCreate");
  });

  it("sends both prices and the period", () => {
    const sp = input.sellingPlansToUpdate[0];
    expect(sp.pricingPolicies).toEqual([
      { fixed: { adjustmentType: "PRICE", adjustmentValue: { fixedValue: "150.00" } } },
      {
        recurring: {
          adjustmentType: "PRICE",
          adjustmentValue: { fixedValue: "100.00" },
          afterCycle: 1,
        },
      },
    ]);
    expect(sp.billingPolicy).toEqual({ recurring: { interval: "YEAR", intervalCount: 1 } });
    expect(input.name).toBe("Coach membership");
  });
});

describe("planFromShopify", () => {
  const madeByApp = {
    billingPolicy: { interval: "YEAR", intervalCount: 1 },
    pricingPolicies: [
      { adjustmentType: "PRICE", adjustmentValue: { amount: "120.0" } },
      { afterCycle: 1, adjustmentType: "PRICE", adjustmentValue: { amount: "90.0" } },
    ],
  };

  it("reads the joining price, renewal price and period", () => {
    expect(planFromShopify(madeByApp)).toEqual({
      joiningPrice: 120,
      renewalPrice: 90,
      interval: "YEAR",
      intervalCount: 1,
    });
  });

  it("refuses a plan with extra pricing policies", () => {
    expect(
      planFromShopify({
        ...madeByApp,
        pricingPolicies: [
          ...madeByApp.pricingPolicies,
          { afterCycle: 1, adjustmentType: "PRICE", adjustmentValue: { amount: "80.0" } },
        ],
      }),
    ).toBeNull();
  });

  it("refuses percentage discounts and weekly plans it did not make", () => {
    expect(
      planFromShopify({
        ...madeByApp,
        pricingPolicies: [
          { adjustmentType: "PERCENTAGE", adjustmentValue: {} },
          madeByApp.pricingPolicies[1],
        ],
      }),
    ).toBeNull();
    expect(
      planFromShopify({ ...madeByApp, billingPolicy: { interval: "WEEK", intervalCount: 1 } }),
    ).toBeNull();
  });
});

describe("sameTerms", () => {
  const terms = { joiningPrice: 120, renewalPrice: 90, interval: "YEAR" as const, intervalCount: 1 };

  it("matches identical terms and spots any difference", () => {
    expect(sameTerms(terms, { ...terms })).toBe(true);
    expect(sameTerms(terms, { ...terms, renewalPrice: 95 })).toBe(false);
    expect(sameTerms(terms, { ...terms, interval: "MONTH" })).toBe(false);
  });
});

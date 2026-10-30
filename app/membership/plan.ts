// Plan setup: checking the merchant's form and building the Shopify selling
// plan group for it. Pure functions: no Shopify calls, no database.
//
// The joining price is the selling plan's fixed price policy (first order);
// the renewal price is its recurring policy with `afterCycle: 1` (second order
// on). Shopify applies both when it bills; the app never adjusts prices.

export type PlanInterval = "MONTH" | "YEAR";

export interface PlanForm {
  name: string;
  tag: string;
  productId: string;
  joiningPrice: string;
  renewalPrice: string;
  interval: string;
  intervalCount: string;
}

export interface PlanInput {
  name: string;
  tag: string;
  productId: string;
  joiningPrice: number;
  renewalPrice: number;
  interval: PlanInterval;
  intervalCount: number;
}

export type PlanFormErrors = Partial<Record<keyof PlanForm, string>>;

export type PlanFormResult =
  | { ok: true; plan: PlanInput }
  | { ok: false; errors: PlanFormErrors };

const PRICE = /^\d+(\.\d{1,2})?$/;
const PRODUCT_ID = /^gid:\/\/shopify\/Product\/\d+$/;

export function parsePlanForm(form: PlanForm): PlanFormResult {
  const errors: PlanFormErrors = {};
  const name = form.name.trim();
  const tag = form.tag.trim();

  if (!name) errors.name = "Enter a plan name.";
  if (!tag) errors.tag = "Enter a customer tag.";
  else if (tag.includes(",")) errors.tag = "A tag cannot contain a comma.";
  else if (tag.length > 255) errors.tag = "A tag can have up to 255 letters.";
  if (!PRODUCT_ID.test(form.productId)) {
    errors.productId = "Pick a membership product.";
  }
  const joiningPrice = form.joiningPrice.trim();
  const renewalPrice = form.renewalPrice.trim();
  if (!PRICE.test(joiningPrice)) {
    errors.joiningPrice = "Enter a price like 120 or 120.00.";
  }
  if (!PRICE.test(renewalPrice)) {
    errors.renewalPrice = "Enter a price like 90 or 90.00.";
  }
  if (form.interval !== "MONTH" && form.interval !== "YEAR") {
    errors.interval = "Choose months or years.";
  }
  const intervalCount = Number(form.intervalCount);
  if (!Number.isInteger(intervalCount) || intervalCount < 1) {
    errors.intervalCount = "Enter a whole number, 1 or more.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    plan: {
      name,
      tag,
      productId: form.productId,
      joiningPrice: Number(joiningPrice),
      renewalPrice: Number(renewalPrice),
      interval: form.interval as PlanInterval,
      intervalCount,
    },
  };
}

const money = (amount: number) => amount.toFixed(2);

/**
 * The `SellingPlanGroupInput` for a plan: one selling plan that bills and
 * renews every `intervalCount` intervals with no end date, priced at the
 * joining price first and the renewal price from the second order on.
 */
export function sellingPlanGroupInput(plan: PlanInput) {
  const cadence = { interval: plan.interval, intervalCount: plan.intervalCount };
  return {
    name: plan.name,
    merchantCode: plan.name,
    options: ["Membership"],
    sellingPlansToCreate: [
      {
        name: plan.name,
        options: [plan.name],
        category: "SUBSCRIPTION",
        billingPolicy: { recurring: { ...cadence } },
        deliveryPolicy: { recurring: { ...cadence } },
        pricingPolicies: [
          {
            fixed: {
              adjustmentType: "PRICE",
              adjustmentValue: { fixedValue: money(plan.joiningPrice) },
            },
          },
          {
            recurring: {
              adjustmentType: "PRICE",
              adjustmentValue: { fixedValue: money(plan.renewalPrice) },
              afterCycle: 1,
            },
          },
        ],
      },
    ],
  };
}

// Plan setup: checking the merchant's form and building the Shopify selling
// plan group for it. Pure functions: no Shopify calls, no database.
//
// The joining price is the selling plan's fixed price policy (first order);
// the renewal price is its recurring policy with `afterCycle: 1` (second order
// on). Shopify only records them: before each renewal the renewal job sets
// the contract line to the price owed (see linePriceChanges in renewals.ts).

export type PlanInterval = "MONTH" | "YEAR";

export interface PlanForm {
  name: string;
  tag: string;
  productId: string;
  joiningPrice: string;
  renewalPrice: string;
  interval: string;
  intervalCount: string;
  /** Percent off for members; empty for none. */
  memberDiscount?: string;
}

export interface PlanInput {
  name: string;
  tag: string;
  productId: string;
  joiningPrice: number;
  renewalPrice: number;
  interval: PlanInterval;
  intervalCount: number;
  /** Percent off everything members buy (1-100), or null for none. */
  memberDiscount?: number | null;
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
  const discountText = (form.memberDiscount ?? "").trim();
  const memberDiscount = discountText === "" ? null : Number(discountText);
  if (
    memberDiscount !== null &&
    (!Number.isInteger(memberDiscount) || memberDiscount < 1 || memberDiscount > 100)
  ) {
    errors.memberDiscount = "Enter a whole percent from 1 to 100, or leave it empty.";
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
      memberDiscount,
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
  return {
    ...groupFields(plan),
    sellingPlansToCreate: [
      { ...sellingPlanFields(plan), category: "SUBSCRIPTION" },
    ],
  };
}

/**
 * The `SellingPlanGroupInput` that changes an existing plan in place. The
 * pricing policies are sent whole; `planFromShopify` reads them back so the
 * caller can check Shopify holds exactly these two prices.
 */
export function sellingPlanGroupUpdateInput(
  plan: PlanInput,
  sellingPlanId: string,
) {
  return {
    ...groupFields(plan),
    sellingPlansToUpdate: [{ id: sellingPlanId, ...sellingPlanFields(plan) }],
  };
}

function groupFields(plan: PlanInput) {
  return { name: plan.name, merchantCode: plan.name, options: ["Membership"] };
}

function sellingPlanFields(plan: PlanInput) {
  const cadence = { interval: plan.interval, intervalCount: plan.intervalCount };
  return {
    name: plan.name,
    options: [plan.name],
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
  };
}

/** A selling plan as the Admin API returns it (only the fields read here). */
export interface ShopifySellingPlan {
  billingPolicy?: { interval?: string; intervalCount?: number } | null;
  pricingPolicies?: {
    afterCycle?: number;
    adjustmentType?: string;
    adjustmentValue?: { amount?: string } | null;
  }[];
}

export interface PlanTerms {
  joiningPrice: number;
  renewalPrice: number;
  interval: PlanInterval;
  intervalCount: number;
}

/**
 * The prices and period of a selling plan made by this app: one fixed PRICE
 * policy (joining) and one recurring PRICE policy after cycle 1 (renewal).
 * Returns null for any other shape, so the app never edits a plan it would
 * misread.
 */
export function planFromShopify(plan: ShopifySellingPlan): PlanTerms | null {
  const interval = plan.billingPolicy?.interval;
  const intervalCount = plan.billingPolicy?.intervalCount;
  if ((interval !== "MONTH" && interval !== "YEAR") || !intervalCount) {
    return null;
  }
  const policies = plan.pricingPolicies ?? [];
  if (policies.length !== 2) return null;
  const fixed = policies.find((p) => p.afterCycle === undefined);
  const recurring = policies.find((p) => p.afterCycle === 1);
  if (fixed?.adjustmentType !== "PRICE" || recurring?.adjustmentType !== "PRICE") {
    return null;
  }
  const joiningPrice = Number(fixed.adjustmentValue?.amount);
  const renewalPrice = Number(recurring.adjustmentValue?.amount);
  if (!Number.isFinite(joiningPrice) || !Number.isFinite(renewalPrice)) {
    return null;
  }
  return { joiningPrice, renewalPrice, interval, intervalCount };
}

export function sameTerms(a: PlanTerms, b: PlanTerms): boolean {
  return (
    a.joiningPrice === b.joiningPrice &&
    a.renewalPrice === b.renewalPrice &&
    a.interval === b.interval &&
    a.intervalCount === b.intervalCount
  );
}

/**
 * The `productVariantsBulkUpdate` input that prices every variant of the
 * membership product at the joining price, so the storefront shows what the
 * member pays first instead of a "saving" against an unrelated price.
 */
export function variantPriceInputs(variantIds: string[], joiningPrice: number) {
  return variantIds.map((id) => ({
    id,
    price: money(joiningPrice),
    // A membership is never shipped; without this every order waits to be
    // fulfilled.
    inventoryItem: { requiresShipping: false },
  }));
}

/**
 * The customer segment query for "has this plan's tag". Membership is what
 * puts the tag on a customer, so the segment follows membership by itself.
 */
export function memberSegmentQuery(tag: string): string {
  const escaped = tag.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `customer_tags CONTAINS '${escaped}'`;
}

/**
 * The automatic discount giving a plan's members `percent` off. It applies to
 * one-time purchases only, so the membership itself is never discounted.
 */
export function memberDiscountInput(
  planName: string,
  percent: number,
  segmentId: string,
  startsAt: Date,
) {
  return {
    title: `${planName}: member price (${percent}% off)`,
    startsAt: startsAt.toISOString(),
    context: { customerSegments: { add: [segmentId] } },
    customerGets: {
      value: { percentage: percent / 100 },
      items: { all: true },
      appliesOnOneTimePurchase: true,
      appliesOnSubscription: false,
    },
    combinesWith: {
      orderDiscounts: false,
      productDiscounts: false,
      shippingDiscounts: true,
    },
  };
}

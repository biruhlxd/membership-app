// Plan setup against Shopify and the database. The rules (form checks, the
// selling plan group input) live in plan.ts.
//
// All operations are validated against the 2026-10 Admin API schema. They
// need read_products, write_products and write_purchase_options; the
// protected subscription scopes are not required for plan setup.
import prisma from "../db.server";
import {
  planFromShopify,
  sameTerms,
  sellingPlanGroupInput,
  sellingPlanGroupUpdateInput,
  variantPriceInputs,
  type PlanInput,
  type PlanTerms,
  type ShopifySellingPlan,
} from "./plan";

type Admin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

const CREATE_GROUP = `#graphql
  mutation membershipSellingPlanGroupCreate(
    $input: SellingPlanGroupInput!
    $resources: SellingPlanGroupResourceInput
  ) {
    sellingPlanGroupCreate(input: $input, resources: $resources) {
      sellingPlanGroup {
        id
        sellingPlans(first: 1) {
          nodes {
            id
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }`;

const DELETE_GROUP = `#graphql
  mutation membershipSellingPlanGroupDelete($id: ID!) {
    sellingPlanGroupDelete(id: $id) {
      deletedSellingPlanGroupId
      userErrors {
        field
        message
      }
    }
  }`;

const PRODUCT = `#graphql
  query membershipProduct($id: ID!) {
    product(id: $id) {
      requiresSellingPlan
      variants(first: 100) {
        nodes {
          id
        }
      }
    }
  }`;

const SET_VARIANT_PRICES = `#graphql
  mutation membershipVariantPrices(
    $productId: ID!
    $variants: [ProductVariantsBulkInput!]!
  ) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      userErrors {
        field
        message
      }
    }
  }`;

const REQUIRE_PLAN = `#graphql
  mutation membershipRequirePlan($id: ID!) {
    productUpdate(product: { id: $id, requiresSellingPlan: true }) {
      product {
        id
      }
      userErrors {
        field
        message
      }
    }
  }`;

export type CreatePlanResult =
  | { ok: true; warning?: string }
  | { ok: false; error: string };

/**
 * Make the product a membership product: every variant priced at the joining
 * price, and sold only through a plan (no one-time purchase). Returns a
 * warning for the merchant when Shopify refuses either change.
 */
async function prepareProduct(
  admin: Admin,
  productId: string,
  joiningPrice: number,
): Promise<string | undefined> {
  try {
    const product = (
      await (await admin.graphql(PRODUCT, { variables: { id: productId } })).json()
    ).data?.product;
    const variantIds: string[] = (product?.variants?.nodes ?? []).map(
      (v: { id: string }) => v.id,
    );
    const problems: string[] = [];

    if (variantIds.length > 0) {
      const prices = (
        await (
          await admin.graphql(SET_VARIANT_PRICES, {
            variables: {
              productId,
              variants: variantPriceInputs(variantIds, joiningPrice),
            },
          })
        ).json()
      ).data?.productVariantsBulkUpdate;
      if (!prices || prices.userErrors?.length) {
        problems.push("set the product's price to the joining price");
      }
    }

    if (!product?.requiresSellingPlan) {
      const required = (
        await (
          await admin.graphql(REQUIRE_PLAN, { variables: { id: productId } })
        ).json()
      ).data?.productUpdate;
      if (!required || required.userErrors?.length) {
        problems.push("turn off one-time purchase for the product");
      }
    }

    if (problems.length === 0) return undefined;
    return `The plan is saved, but the app could not ${problems.join(" or ")}. Do it on the product page.`;
  } catch {
    return "The plan is saved, but the app could not update the product. Set its price to the joining price and turn off one-time purchase on the product page.";
  }
}

export async function createPlan(
  admin: Admin,
  shop: string,
  plan: PlanInput,
): Promise<CreatePlanResult> {
  // Check before anything is made in Shopify.
  if (await tagTaken(shop, plan.tag)) {
    return { ok: false, error: `Another plan already uses the tag "${plan.tag}".` };
  }

  let result;
  try {
    const response = await admin.graphql(CREATE_GROUP, {
      variables: {
        input: sellingPlanGroupInput(plan),
        resources: { productIds: [plan.productId] },
      },
    });
    result = (await response.json()).data?.sellingPlanGroupCreate;
  } catch {
    return { ok: false, error: "Shopify could not create the plan. Try again." };
  }
  const errors: { message: string }[] = result?.userErrors ?? [];
  const groupId: string | undefined = result?.sellingPlanGroup?.id;
  const sellingPlanId: string | undefined =
    result?.sellingPlanGroup?.sellingPlans?.nodes?.[0]?.id;
  if (errors.length > 0 || !groupId || !sellingPlanId) {
    return {
      ok: false,
      error: errors.map((e) => e.message).join(" ") || "Shopify could not create the plan.",
    };
  }

  try {
    await prisma.membershipPlan.create({
      data: {
        shop,
        name: plan.name,
        sellingPlanId,
        sellingPlanGroupId: groupId,
        productId: plan.productId,
        tag: plan.tag,
      },
    });
  } catch {
    // Undo the Shopify side so a plan never exists in Shopify without the app
    // knowing about it. Best effort: if this fails too, the merchant can
    // delete the purchase option from the product.
    await admin
      .graphql(DELETE_GROUP, { variables: { id: groupId } })
      .catch(() => undefined);
    return { ok: false, error: "The plan could not be saved. Try again." };
  }
  const warning = await prepareProduct(admin, plan.productId, plan.joiningPrice);
  return warning ? { ok: true, warning } : { ok: true };
}

/** Tags are unique per shop, ignoring case as Shopify does. */
async function tagTaken(shop: string, tag: string, exceptPlanId?: string) {
  const plans = await prisma.membershipPlan.findMany({
    where: { shop },
    select: { id: true, tag: true },
  });
  const wanted = tag.toLowerCase();
  return plans.some(
    (p) => p.id !== exceptPlanId && p.tag.toLowerCase() === wanted,
  );
}

const GROUP = `#graphql
  query membershipPlanGroup($id: ID!) {
    sellingPlanGroup(id: $id) {
      id
      products(first: 1) {
        nodes {
          id
          title
        }
      }
      sellingPlans(first: 1) {
        nodes {
          id
          billingPolicy {
            ... on SellingPlanRecurringBillingPolicy {
              interval
              intervalCount
            }
          }
          pricingPolicies {
            ... on SellingPlanFixedPricingPolicy {
              adjustmentType
              adjustmentValue {
                ... on MoneyV2 {
                  amount
                }
              }
            }
            ... on SellingPlanRecurringPricingPolicy {
              afterCycle
              adjustmentType
              adjustmentValue {
                ... on MoneyV2 {
                  amount
                }
              }
            }
          }
        }
      }
    }
  }`;

const FIND_GROUPS = `#graphql
  query membershipFindGroup {
    sellingPlanGroups(first: 50) {
      nodes {
        id
        sellingPlans(first: 5) {
          nodes {
            id
          }
        }
      }
    }
  }`;

const UPDATE_GROUP = `#graphql
  mutation membershipSellingPlanGroupUpdate(
    $id: ID!
    $input: SellingPlanGroupInput!
  ) {
    sellingPlanGroupUpdate(id: $id, input: $input) {
      userErrors {
        field
        message
      }
    }
  }`;

export interface EditablePlan {
  id: string;
  name: string;
  tag: string;
  memberCount: number;
  product: { id: string; title: string } | null;
  terms: PlanTerms | null;
}

/** The plan's row, finding and saving its Shopify ids if it predates them. */
async function planWithIds(admin: Admin, shop: string, id: string) {
  const plan = await prisma.membershipPlan.findFirst({ where: { id, shop } });
  if (!plan || plan.sellingPlanGroupId) return plan;

  const groups: { id: string; sellingPlans: { nodes: { id: string }[] } }[] =
    (await (await admin.graphql(FIND_GROUPS)).json()).data?.sellingPlanGroups
      ?.nodes ?? [];
  const group = groups.find((g) =>
    g.sellingPlans.nodes.some((sp) => sp.id === plan.sellingPlanId),
  );
  if (!group) return plan;
  return prisma.membershipPlan.update({
    where: { id: plan.id },
    data: { sellingPlanGroupId: group.id },
  });
}

async function readGroup(admin: Admin, groupId: string) {
  const group = (
    await (await admin.graphql(GROUP, { variables: { id: groupId } })).json()
  ).data?.sellingPlanGroup;
  const sellingPlan = group?.sellingPlans?.nodes?.[0];
  return {
    product: (group?.products?.nodes?.[0] ?? null) as
      | { id: string; title: string }
      | null,
    terms: sellingPlan ? planFromShopify(sellingPlan as ShopifySellingPlan) : null,
  };
}

/**
 * A plan with its current terms read from Shopify (the source of truth).
 * `terms` is null when Shopify's plan is missing or not in the shape this app
 * makes; the page then refuses to edit it.
 */
export async function getPlan(
  admin: Admin,
  shop: string,
  id: string,
): Promise<EditablePlan | null> {
  const plan = await planWithIds(admin, shop, id);
  if (!plan) return null;
  const memberCount = await prisma.membership.count({ where: { planId: plan.id } });
  const shopify = plan.sellingPlanGroupId
    ? await readGroup(admin, plan.sellingPlanGroupId)
    : { product: null, terms: null };

  if (shopify.product && !plan.productId) {
    await prisma.membershipPlan.update({
      where: { id: plan.id },
      data: { productId: shopify.product.id },
    });
  }
  return {
    id: plan.id,
    name: plan.name,
    tag: plan.tag,
    memberCount,
    product: shopify.product,
    terms: shopify.terms,
  };
}

/**
 * Change a plan's name, tag, prices and period. The product stays as it is.
 * Changes apply to new members; Shopify keeps each existing member's
 * contract at the terms they bought.
 */
export async function updatePlan(
  admin: Admin,
  shop: string,
  id: string,
  plan: PlanInput,
): Promise<CreatePlanResult> {
  const row = await planWithIds(admin, shop, id);
  if (!row) return { ok: false, error: "This plan no longer exists." };
  if (!row.sellingPlanGroupId) {
    return { ok: false, error: "The plan was not found in Shopify." };
  }

  const tagChanged = row.tag.toLowerCase() !== plan.tag.toLowerCase();
  if (tagChanged) {
    const members = await prisma.membership.count({ where: { planId: row.id } });
    if (members > 0) {
      return {
        ok: false,
        error: "The tag can't change while the plan has members; they carry the current tag.",
      };
    }
    if (await tagTaken(shop, plan.tag, row.id)) {
      return { ok: false, error: `Another plan already uses the tag "${plan.tag}".` };
    }
  }

  try {
    const result = (
      await (
        await admin.graphql(UPDATE_GROUP, {
          variables: {
            id: row.sellingPlanGroupId,
            input: sellingPlanGroupUpdateInput(plan, row.sellingPlanId),
          },
        })
      ).json()
    ).data?.sellingPlanGroupUpdate;
    const errors: { message: string }[] = result?.userErrors ?? [];
    if (!result || errors.length > 0) {
      return {
        ok: false,
        error: errors.map((e) => e.message).join(" ") || "Shopify could not update the plan.",
      };
    }
  } catch {
    return { ok: false, error: "Shopify could not update the plan. Try again." };
  }

  // Check Shopify now holds exactly the terms sent: one joining price and one
  // renewal price, not extra policies added beside the old ones.
  const after = await readGroup(admin, row.sellingPlanGroupId);
  if (!after.terms || !sameTerms(after.terms, plan)) {
    return {
      ok: false,
      error: "Shopify saved different prices than expected. Check the plan on the product page before selling it.",
    };
  }

  await prisma.membershipPlan.update({
    where: { id: row.id },
    data: { name: plan.name, tag: plan.tag },
  });
  const productId = row.productId ?? after.product?.id;
  const warning = productId
    ? await prepareProduct(admin, productId, plan.joiningPrice)
    : undefined;
  return warning ? { ok: true, warning } : { ok: true };
}

export function listPlans(shop: string) {
  return prisma.membershipPlan.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });
}

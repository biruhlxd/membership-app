// Plan setup against Shopify and the database. The rules (form checks, the
// selling plan group input) live in plan.ts.
//
// All operations are validated against the 2026-10 Admin API schema. They
// need read_products, write_products and write_purchase_options; the
// protected subscription scopes are not required for plan setup.
import prisma from "../db.server";
import {
  sellingPlanGroupInput,
  variantPriceInputs,
  type PlanInput,
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
  // Tags must be unique per shop, ignoring case as Shopify does; check before
  // anything is made in Shopify.
  const existing = await prisma.membershipPlan.findMany({
    where: { shop },
    select: { tag: true },
  });
  const wanted = plan.tag.toLowerCase();
  if (existing.some((p) => p.tag.toLowerCase() === wanted)) {
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
      data: { shop, name: plan.name, sellingPlanId, tag: plan.tag },
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

export function listPlans(shop: string) {
  return prisma.membershipPlan.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });
}

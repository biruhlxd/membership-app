// Plan setup against Shopify and the database. The rules (form checks, the
// selling plan group input) live in plan.ts.
//
// Both mutations are validated against the 2026-10 Admin API schema. They need
// write_products and write_purchase_options; the protected subscription
// scopes are not required for plan setup.
import prisma from "../db.server";
import { sellingPlanGroupInput, type PlanInput } from "./plan";

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

export type CreatePlanResult =
  | { ok: true }
  | { ok: false; error: string };

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
  return { ok: true };
}

export function listPlans(shop: string) {
  return prisma.membershipPlan.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });
}

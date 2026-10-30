// Plan setup against Shopify and the database. The rules (form checks, the
// selling plan group input) live in plan.ts.
//
// NOTE: the GraphQL below was written without access to Shopify's schema
// (dev MCP and shopify.dev were unreachable). Validate it against the 2026-10
// Admin API schema before running it on a store.
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

export type CreatePlanResult =
  | { ok: true }
  | { ok: false; error: string };

export async function createPlan(
  admin: Admin,
  shop: string,
  plan: PlanInput,
): Promise<CreatePlanResult> {
  // Tags must be unique per shop; check before anything is made in Shopify.
  const taken = await prisma.membershipPlan.findFirst({
    where: { shop, tag: { equals: plan.tag } },
  });
  if (taken) return { ok: false, error: `Another plan already uses the tag "${plan.tag}".` };

  const response = await admin.graphql(CREATE_GROUP, {
    variables: {
      input: sellingPlanGroupInput(plan),
      resources: { productIds: [plan.productId] },
    },
  });
  const { data } = await response.json();
  const result = data?.sellingPlanGroupCreate;
  const errors: { message: string }[] = result?.userErrors ?? [];
  const sellingPlanId: string | undefined =
    result?.sellingPlanGroup?.sellingPlans?.nodes?.[0]?.id;
  if (errors.length > 0 || !sellingPlanId) {
    return {
      ok: false,
      error: errors.map((e) => e.message).join(" ") || "Shopify could not create the plan.",
    };
  }

  await prisma.membershipPlan.create({
    data: { shop, name: plan.name, sellingPlanId, tag: plan.tag },
  });
  return { ok: true };
}

export function listPlans(shop: string) {
  return prisma.membershipPlan.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });
}

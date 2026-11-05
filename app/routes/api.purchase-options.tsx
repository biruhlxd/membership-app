import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { parsePlanForm } from "../membership/plan";
import { createPlan, getPlan, updatePlan } from "../membership/plans.server";
import { seatTypesFromJson } from "../membership/organizations";

// Called by the purchase options extension on the Shopify product and variant
// pages (extensions/purchase-options), with the admin's session token. Plans
// made here are the same as on the app's Plans page: same checks, same
// product pricing and member discounts.

const VARIANT_PRODUCT = `#graphql
  query purchaseOptionVariantProduct($id: ID!) {
    productVariant(id: $id) {
      product {
        id
      }
    }
  }`;

/** GET ?groupId=<selling plan group gid>: the plan to edit, or null. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, cors } = await authenticate.admin(request);
  const groupId = new URL(request.url).searchParams.get("groupId") ?? "";
  const row = groupId
    ? await prisma.membershipPlan.findFirst({ where: { shop: session.shop, sellingPlanGroupId: groupId } })
    : null;
  const plan = row ? await getPlan(admin, session.shop, row.id) : null;
  return cors(
    Response.json({
      plan:
        plan && plan.terms
          ? {
              name: plan.name,
              tag: plan.tag,
              memberCount: plan.memberCount,
              joiningPrice: plan.terms.joiningPrice.toFixed(2),
              renewalPrice: plan.terms.renewalPrice.toFixed(2),
              interval: plan.terms.interval,
              intervalCount: String(plan.terms.intervalCount),
              memberDiscount: plan.memberDiscount ? String(plan.memberDiscount) : "",
            }
          : null,
      // A group of another app, or one this app can't edit (made elsewhere).
      editable: !groupId || Boolean(plan?.terms),
    }),
  );
};

/** POST JSON: create (resourceId, no groupId) or update (groupId) a plan. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, cors } = await authenticate.admin(request);
  const body = (await request.json().catch(() => ({}))) as Record<string, string>;
  const resourceId = String(body.resourceId ?? "");
  const groupId = String(body.groupId ?? "");

  let productId = resourceId;
  let variantIds: string[] | undefined;
  if (resourceId.startsWith("gid://shopify/ProductVariant/")) {
    const json = (await (await admin.graphql(VARIANT_PRODUCT, { variables: { id: resourceId } })).json()) as {
      data?: { productVariant?: { product?: { id: string } } | null };
    };
    productId = json.data?.productVariant?.product?.id ?? "";
    variantIds = [resourceId];
  }

  const row = groupId
    ? await prisma.membershipPlan.findFirst({ where: { shop: session.shop, sellingPlanGroupId: groupId } })
    : null;
  if (groupId && !row) {
    return cors(Response.json({ ok: false, error: "This purchase option wasn't made by Biruh Membership." }));
  }

  const parsed = parsePlanForm({
    name: String(body.name ?? ""),
    tag: String(body.tag ?? ""),
    productId: row?.productId ?? productId,
    joiningPrice: String(body.joiningPrice ?? ""),
    renewalPrice: String(body.renewalPrice ?? ""),
    interval: String(body.interval ?? ""),
    intervalCount: String(body.intervalCount ?? ""),
    memberDiscount: String(body.memberDiscount ?? ""),
  });
  if (!parsed.ok) return cors(Response.json({ ok: false, errors: parsed.errors }));

  const result = row
    ? await updatePlan(admin, session.shop, row.id, {
        ...parsed.plan,
        // Seats are edited on the app's Plans page; keep them as they are.
        seatTypes: seatTypesFromJson(row.seatTypes),
      })
    : await createPlan(admin, session.shop, parsed.plan, variantIds);
  return cors(Response.json(result));
};

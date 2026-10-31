import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncContract } from "../membership/contracts.server";
import { refreshSchedule } from "../membership/renewals.server";

// Every subscription_contracts/* topic lands here. The payload only names the
// contract; syncContract reads its current state from Shopify.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);

  // No admin context means the app is no longer installed on this shop.
  if (!admin) return new Response();

  const contractId = (payload as { admin_graphql_api_id?: string })
    .admin_graphql_api_id;
  if (!contractId) return new Response();

  try {
    const result = await syncContract(admin, shop, contractId);
    console.log(`${topic} ${contractId} for ${shop}:`, JSON.stringify(result));
    if (result.synced) {
      const membership = await prisma.membership.findUnique({
        where: { shop_contractId: { shop, contractId } },
        select: { id: true },
      });
      if (membership) await refreshSchedule(admin, membership.id);
    }
  } catch (error) {
    // A 500 makes Shopify retry the webhook later.
    console.error(`${topic} ${contractId} for ${shop} failed:`, error);
    return new Response(null, { status: 500 });
  }
  return new Response();
};

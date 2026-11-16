import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { endOnRefund } from "../membership/contracts.server";
import { refreshSchedule } from "../membership/renewals.server";

// refunds/create: a fully refunded membership order ends the membership at
// once (contracts.server.ts, endOnRefund).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, admin } = await authenticate.webhook(request);
  if (!admin) return new Response();
  const orderId = (payload as { order_id?: number }).order_id;
  if (!orderId) return new Response();
  try {
    const ended = await endOnRefund(admin, shop, `gid://shopify/Order/${orderId}`);
    if (ended.length > 0) {
      console.log(`refunds/create order ${orderId} for ${shop}: ${ended.length} membership(s) ended`);
      // Clears the stored renewal date and the customer's membership.renews_on.
      for (const id of ended) await refreshSchedule(admin, id);
    }
  } catch (error) {
    console.error(`refunds/create order ${orderId} for ${shop} failed:`, error);
    return new Response(null, { status: 500 });
  }
  return new Response();
};

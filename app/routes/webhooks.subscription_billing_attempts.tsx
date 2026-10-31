import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { recordAttemptResult } from "../membership/renewals.server";

// subscription_billing_attempts/success, /failure and /challenged land here.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);
  if (!admin) return new Response();

  try {
    const result = await recordAttemptResult(admin, shop, topic, payload as never);
    console.log(`${topic} for ${shop}:`, JSON.stringify(result));
  } catch (error) {
    // A 500 makes Shopify retry the webhook later.
    console.error(`${topic} for ${shop} failed:`, error);
    return new Response(null, { status: 500 });
  }
  return new Response();
};

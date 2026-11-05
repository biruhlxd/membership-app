import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { saveAppPlan, shopAppFeatures } from "../membership/appBilling.server";
import { APP_PLANS, type AppPlanName } from "../membership/appPlans";

// app_subscriptions/update: the merchant's Biruh Membership plan was approved,
// cancelled, declined or ended. App pages also refresh it on load.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const subscription = (payload as { app_subscription?: { name?: string; status?: string } }).app_subscription;
  const name = subscription?.name ?? "";
  if (!(APP_PLANS as readonly string[]).includes(name)) return new Response();
  if (subscription?.status === "ACTIVE") {
    await saveAppPlan(shop, name as AppPlanName);
  } else if ((await shopAppFeatures(shop)).plan === name) {
    await saveAppPlan(shop, "None");
  }
  return new Response();
};

// The shop's Biruh Membership plan. Shopify's billing check needs an admin
// request, so the plan is also stored per shop for places without one:
// refreshed on app page loads (at most every five minutes) and on the
// app_subscriptions/update webhook.
import prisma from "../db.server";
import type { authenticate } from "../shopify.server";
import { APP_PLANS, appFeaturesOf, appPlanFromSubscriptions, type AppFeatures, type AppPlanName } from "./appPlans";

type AdminContext = Awaited<ReturnType<typeof authenticate.admin>>;

const DEV_STORE = `#graphql
  query membershipShopIsDevelopment {
    shop {
      plan {
        partnerDevelopment
      }
    }
  }`;

/** Test charges on development stores (they can't be charged) and outside production. */
export async function testCharges(admin: AdminContext["admin"]): Promise<boolean> {
  if (process.env.NODE_ENV !== "production") return true;
  const json = (await (await admin.graphql(DEV_STORE)).json()) as {
    data?: { shop?: { plan?: { partnerDevelopment?: boolean } } };
  };
  return json.data?.shop?.plan?.partnerDevelopment !== false;
}

export async function refreshAppPlan(context: Pick<AdminContext, "admin" | "billing" | "session">): Promise<AppPlanName> {
  const isTest = await testCharges(context.admin);
  const check = await context.billing.check({ plans: [...APP_PLANS], isTest });
  const plan = appPlanFromSubscriptions(check.appSubscriptions.map((s) => ({ name: s.name, status: s.status })));
  await saveAppPlan(context.session.shop, plan);
  return plan;
}

const lastAsked = new Map<string, number>();

/** refreshAppPlan at most every five minutes per shop; never throws. */
export async function refreshAppPlanSoon(context: Pick<AdminContext, "admin" | "billing" | "session">): Promise<void> {
  const shop = context.session.shop;
  if (Date.now() - (lastAsked.get(shop) ?? 0) < 5 * 60_000) return;
  lastAsked.set(shop, Date.now());
  try {
    await refreshAppPlan(context);
  } catch (error) {
    console.error(`app plan of ${shop} not checked:`, error);
  }
}

export async function saveAppPlan(shop: string, plan: AppPlanName): Promise<void> {
  await prisma.shopAppPlan.upsert({ where: { shop }, create: { shop, plan }, update: { plan } });
}

export async function shopAppFeatures(shop: string): Promise<AppFeatures & { plan: AppPlanName }> {
  const row = await prisma.shopAppPlan.findUnique({ where: { shop } });
  const plan: AppPlanName = (APP_PLANS as readonly string[]).includes(row?.plan ?? "") ? (row!.plan as AppPlanName) : "None";
  return { ...appFeaturesOf(plan), plan };
}

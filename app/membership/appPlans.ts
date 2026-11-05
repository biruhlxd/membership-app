// What merchants pay for Biruh Membership, and what each plan includes. The
// one place to change prices and limits. (Not to be confused with membership
// plans, which merchants sell to their members.) Plan names are what Shopify
// shows on the charge and must not change once merchants are subscribed.
//
// Limits never stop members who already paid: renewals, access and tags work
// whatever the merchant's plan. They only stop setting up new things.

export const STARTER = "Biruh Membership Starter";
export const GROWTH = "Biruh Membership Growth";
export const ASSOCIATION = "Biruh Membership Association";
export const APP_PLANS = [STARTER, GROWTH, ASSOCIATION] as const;
export type PaidAppPlan = (typeof APP_PLANS)[number];
export type AppPlanName = PaidAppPlan | "None";

/** Price every 30 days in USD, and the free trial. */
export const APP_PRICES: Record<PaidAppPlan, { amount: number; trialDays: number }> = {
  [STARTER]: { amount: 19, trialDays: 14 },
  [GROWTH]: { amount: 59, trialDays: 14 },
  [ASSOCIATION]: { amount: 149, trialDays: 14 },
};

export interface AppFeatures {
  /** Can create membership plans at all. */
  plans: boolean;
  /** Active members the plan is meant for (a warning above it, never a block). */
  members: number;
  /** Organization seat plans. */
  organizations: boolean;
  /** Credential types. */
  credentials: boolean;
}

const FEATURES: Record<AppPlanName, AppFeatures> = {
  None: { plans: false, members: 0, organizations: false, credentials: false },
  [STARTER]: { plans: true, members: 100, organizations: false, credentials: false },
  [GROWTH]: { plans: true, members: 1000, organizations: true, credentials: true },
  [ASSOCIATION]: { plans: true, members: Infinity, organizations: true, credentials: true },
};

export function appFeaturesOf(plan: string | null | undefined): AppFeatures {
  return FEATURES[(APP_PLANS as readonly string[]).includes(plan ?? "") ? (plan as PaidAppPlan) : "None"];
}

/** The best active subscription (Association over Growth over Starter), or None. */
export function appPlanFromSubscriptions(subscriptions: { name: string; status?: string }[]): AppPlanName {
  const active = new Set(subscriptions.filter((s) => !s.status || s.status === "ACTIVE").map((s) => s.name));
  return ([ASSOCIATION, GROWTH, STARTER] as const).find((plan) => active.has(plan)) ?? "None";
}

/** Shown when the shop has more active members than its plan is meant for. */
export function overMemberLimit(plan: AppPlanName, activeMembers: number): boolean {
  return plan !== "None" && activeMembers > appFeaturesOf(plan).members;
}

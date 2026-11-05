import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { refreshAppPlan, saveAppPlan, testCharges } from "../membership/appBilling.server";
import {
  APP_PLANS,
  APP_PRICES,
  appFeaturesOf,
  ASSOCIATION,
  GROWTH,
  STARTER,
  type PaidAppPlan,
} from "../membership/appPlans";
import { grantsAccess, type MembershipStatus } from "../membership/status";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await authenticate.admin(request);
  const plan = await refreshAppPlan(context);
  const memberships = await prisma.membership.findMany({ where: { shop: context.session.shop }, select: { status: true } });
  return { plan, activeMembers: memberships.filter((m) => grantsAccess(m.status as MembershipStatus)).length };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const form = await request.formData();
  const isTest = await testCharges(admin);
  const choice = String(form.get("plan"));
  if ((APP_PLANS as readonly string[]).includes(choice)) {
    // Sends the merchant to Shopify to approve the charge; Shopify brings them back.
    await billing.request({ plan: choice as PaidAppPlan, isTest });
    return null;
  }
  if (choice === "None") {
    const check = await billing.check({ plans: [...APP_PLANS], isTest });
    for (const subscription of check.appSubscriptions) {
      await billing.cancel({ subscriptionId: subscription.id, isTest, prorate: true });
    }
    await saveAppPlan(session.shop, "None");
    return { message: "Your plan is cancelled. Existing members keep renewing; you can't set up new plans until you choose a plan again." };
  }
  return { message: "Unknown plan." };
};

const DESCRIPTIONS: Record<PaidAppPlan, string[]> = {
  [STARTER]: [
    "Up to 100 active members",
    "Joining and renewal prices, automatic renewals and card retries",
    "Reminder and payment emails, member pricing, members-only products",
    "Member portal in the customer account",
  ],
  [GROWTH]: ["Up to 1,000 active members", "Everything in Starter", "Organization seats", "Credentials with public verification"],
  [ASSOCIATION]: ["Unlimited members", "Everything in Growth", "Priority support"],
};

export default function Billing() {
  const { plan, activeMembers } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const short = (name: string) => name.replace("Biruh Membership ", "");
  const limit = appFeaturesOf(plan).members;

  return (
    <s-page heading="App plan">
      {fetcher.data?.message && <s-banner tone="success">{fetcher.data.message}</s-banner>}
      {plan !== "None" && activeMembers > limit && (
        <s-banner tone="warning">
          You have {activeMembers} active members; the {short(plan)} plan is for up to {limit}. Your members aren&apos;t
          affected, but please choose a larger plan.
        </s-banner>
      )}
      <s-section>
        <s-paragraph>
          {plan === "None" ? (
            <>
              Choose a plan to set up membership plans. Every plan starts with a free trial. Members who already joined
              keep renewing whatever you choose.
            </>
          ) : (
            <>
              You&apos;re on <s-text type="strong">{short(plan)}</s-text>, with {activeMembers} active members. Charges are
              billed by Shopify with your other app charges and can be changed or cancelled any time.
            </>
          )}
        </s-paragraph>
      </s-section>
      <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
        {APP_PLANS.map((name) => (
          <s-section key={name} heading={short(name)}>
            <s-stack gap="base">
              <s-text type="strong">${APP_PRICES[name].amount} every 30 days</s-text>
              <s-text color="subdued">{APP_PRICES[name].trialDays}-day free trial</s-text>
              <s-unordered-list>
                {DESCRIPTIONS[name].map((line) => (
                  <s-list-item key={line}>{line}</s-list-item>
                ))}
              </s-unordered-list>
              {name === plan ? (
                <s-badge tone="success">Current plan</s-badge>
              ) : (
                <s-button variant="primary" loading={busy} onClick={() => fetcher.submit({ plan: name }, { method: "post" })}>
                  Choose {short(name)}
                </s-button>
              )}
            </s-stack>
          </s-section>
        ))}
      </s-grid>
      {plan !== "None" && (
        <s-section>
          <s-button tone="critical" variant="tertiary" onClick={() => fetcher.submit({ plan: "None" }, { method: "post" })}>
            Cancel my plan
          </s-button>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

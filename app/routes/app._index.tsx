import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const [plans, active, pastDue] = await Promise.all([
    prisma.membershipPlan.count({ where: { shop } }),
    prisma.membership.count({ where: { shop, status: "ACTIVE" } }),
    prisma.membership.count({ where: { shop, status: "PAST_DUE" } }),
  ]);
  const scopes = (session.scope ?? "").split(",");
  return {
    plans,
    active,
    pastDue,
    subscriptionAccess: scopes.includes("write_own_subscription_contracts"),
    // Opens the theme editor on the product template with the "Membership
    // plans" block (blocks/plan-picker.liquid) already added.
    pickerEditorUrl: `shopify://admin/themes/current/editor?template=product&addAppBlockId=${process.env.SHOPIFY_API_KEY ?? ""}/plan-picker&target=mainSection`,
  };
};

type Step = {
  done: boolean;
  title: string;
  body: string;
  action?: { label: string; href: string; external?: boolean };
};

export default function Home() {
  const { plans, active, pastDue, subscriptionAccess, pickerEditorUrl } =
    useLoaderData<typeof loader>();

  const steps: Step[] = [
    {
      done: plans > 0,
      title: "Create a membership plan",
      body: "Choose the product members buy, the joining price and the renewal price.",
      action: { label: "Create plan", href: "/app/plans/new" },
    },
    {
      // A first purchase shows the block is on the product page.
      done: active + pastDue > 0,
      title: "Show your plans on the product page",
      body: "Add the \"Membership plans\" block to your product template so buyers see the joining price, the renewal price and how often it renews. The button opens the theme editor with the block added; place it near the Add to cart button and click Save.",
      action: { label: "Add block in theme editor", href: pickerEditorUrl, external: true },
    },
    {
      done: active + pastDue > 0,
      title: "Welcome your first member",
      body: "Members appear here after they buy a plan in your store.",
    },
  ];
  const completed = steps.filter((s) => s.done).length;

  return (
    <s-page heading="Membership">
      {!subscriptionAccess && (
        <s-banner tone="warning" heading="Renewals are not available yet">
          This store hasn&apos;t granted the app access to subscription contracts, so
          renewals can&apos;t be charged. Open the app again from your Apps list to
          approve the access, or contact support.
        </s-banner>
      )}
      {completed < steps.length && (
        <s-section heading="Setup guide">
          <s-stack direction="block" gap="base">
            <s-paragraph color="subdued">
              {completed} of {steps.length} steps completed
            </s-paragraph>
            <s-box borderRadius="base" border="base" background="base">
              {steps.map((step, i) => (
                <s-box key={step.title}>
                  {i > 0 && <s-divider />}
                  <s-grid
                    gridTemplateColumns="auto 1fr"
                    gap="base"
                    padding="base"
                    alignItems="start"
                  >
                    <s-icon
                      type={step.done ? "check-circle" : "circle-dashed"}
                      tone={step.done ? "success" : "neutral"}
                    />
                    <s-stack direction="block" gap="small-200">
                      <s-text type="strong">{step.title}</s-text>
                      {!step.done && (
                        <>
                          <s-paragraph color="subdued">{step.body}</s-paragraph>
                          {step.action && (
                            <s-stack direction="inline">
                              <s-button
                                href={step.action.href}
                                {...(step.action.external
                                  ? { target: "_blank" }
                                  : { variant: "primary" })}
                              >
                                {step.action.label}
                              </s-button>
                            </s-stack>
                          )}
                        </>
                      )}
                    </s-stack>
                  </s-grid>
                </s-box>
              ))}
            </s-box>
          </s-stack>
        </s-section>
      )}

      <s-section heading="Members">
        <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
          <Metric label="Active members" value={active} />
          <Metric label="Past due" value={pastDue} />
          <Metric label="Plans" value={plans} href="/app/plans" />
        </s-grid>
      </s-section>
    </s-page>
  );
}

function Metric({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href?: string;
}) {
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack direction="block" gap="small-200">
        {href ? (
          <s-link href={href}>{label}</s-link>
        ) : (
          <s-text color="subdued">{label}</s-text>
        )}
        <s-heading>{value}</s-heading>
      </s-stack>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

import { useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { listPlans } from "../membership/plans.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const plans = await listPlans(session.shop);
  return {
    // Formatted on the server so the page renders the same in every browser.
    plans: plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      tag: plan.tag,
      created: plan.createdAt.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }),
    })),
  };
};

export default function Plans() {
  const { plans } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    if (params.get("created")) {
      shopify.toast.show("Plan created");
      setParams((p) => {
        p.delete("created");
        return p;
      });
    }
  }, [params, setParams, shopify]);

  return (
    <s-page heading="Membership plans">
      <s-button slot="primary-action" variant="primary" href="/app/plans/new">
        Create plan
      </s-button>

      {plans.length === 0 ? (
        <s-section accessibilityLabel="No plans yet">
          <s-stack direction="block" gap="base" alignItems="center" padding="large">
            <s-icon type="product" />
            <s-heading>Create your first membership plan</s-heading>
            <s-paragraph color="subdued">
              A plan sets the product members buy, what they pay to join, what
              they pay at each renewal, and the customer tag they get.
            </s-paragraph>
            <s-button variant="primary" href="/app/plans/new">
              Create plan
            </s-button>
          </s-stack>
        </s-section>
      ) : (
        <s-section padding="none" accessibilityLabel="Plans">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Plan</s-table-header>
              <s-table-header listSlot="labeled">Customer tag</s-table-header>
              <s-table-header listSlot="labeled">Created</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {plans.map((plan) => (
                <s-table-row key={plan.id}>
                  <s-table-cell>{plan.name}</s-table-cell>
                  <s-table-cell>
                    <s-badge>{plan.tag}</s-badge>
                  </s-table-cell>
                  <s-table-cell>{plan.created}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

import { useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { listPlans } from "../membership/plans.server";
import { seatTypesFromJson } from "../membership/organizations";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const plans = await listPlans(session.shop);
  return {
    // Formatted on the server so the page renders the same in every browser.
    plans: plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      tag: plan.tag,
      seats: seatTypesFromJson(plan.seatTypes)
        .map((s) => `${s.seats} ${s.name}`)
        .join(", "),
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
    const done = params.get("created")
      ? "Plan created"
      : params.get("updated")
        ? "Plan updated"
        : null;
    if (done) {
      shopify.toast.show(done);
      setParams((p) => {
        p.delete("created");
        p.delete("updated");
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
              <s-table-header listSlot="labeled">Seats</s-table-header>
              <s-table-header listSlot="labeled">Created</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {plans.map((plan) => (
                <s-table-row key={plan.id} clickDelegate={`plan-${plan.id}`}>
                  <s-table-cell>
                    <s-link id={`plan-${plan.id}`} href={`/app/plans/${plan.id}`}>
                      {plan.name}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge>{plan.tag}</s-badge>
                  </s-table-cell>
                  <s-table-cell>{plan.seats || "For one person"}</s-table-cell>
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

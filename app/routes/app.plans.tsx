import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { parsePlanForm, type PlanFormErrors } from "../membership/plan";
import { createPlan, listPlans } from "../membership/plans.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { plans: await listPlans(session.shop) };
};

type ActionResult = {
  errors: PlanFormErrors;
  error: string | null;
  saved: boolean;
  warning: string | null;
};

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  const { admin, session } = await authenticate.admin(request);
  const data = await request.formData();
  const field = (key: string) => String(data.get(key) ?? "");

  const parsed = parsePlanForm({
    name: field("name"),
    tag: field("tag"),
    productId: field("productId"),
    joiningPrice: field("joiningPrice"),
    renewalPrice: field("renewalPrice"),
    interval: field("interval"),
    intervalCount: field("intervalCount"),
  });
  if (!parsed.ok) return { errors: parsed.errors, error: null, saved: false, warning: null };

  const result = await createPlan(admin, session.shop, parsed.plan);
  if (!result.ok) return { errors: {}, error: result.error, saved: false, warning: null };
  return { errors: {}, error: null, saved: true, warning: result.warning ?? null };
};

export default function Plans() {
  const { plans } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [product, setProduct] = useState<{ id: string; title: string } | null>(
    null,
  );
  const errors = fetcher.data?.errors ?? {};
  const saving = fetcher.state !== "idle";

  const pickProduct = async () => {
    const picked = await shopify.resourcePicker({
      type: "product",
      multiple: false,
    });
    const first = picked?.[0];
    if (first) setProduct({ id: first.id, title: first.title });
  };

  return (
    <s-page heading="Membership plans">
      <s-section heading="Your plans">
        {plans.length === 0 ? (
          <s-paragraph>No plans yet. Add one below.</s-paragraph>
        ) : (
          <s-unordered-list>
            {plans.map((plan) => (
              <s-list-item key={plan.id}>
                {plan.name} (tag: {plan.tag})
              </s-list-item>
            ))}
          </s-unordered-list>
        )}
      </s-section>

      <s-section heading="Add a plan">
        {fetcher.data?.saved && (
          <s-banner tone={fetcher.data.warning ? "warning" : "success"}>
            {fetcher.data.warning ?? "The plan is saved."}
          </s-banner>
        )}
        {fetcher.data?.error && (
          <s-banner tone="critical">{fetcher.data.error}</s-banner>
        )}
        <fetcher.Form method="post">
          <s-stack direction="block" gap="base">
            <s-text-field
              label="Plan name"
              name="name"
              error={errors.name}
            />
            <s-text-field
              label="Customer tag"
              name="tag"
              details="Members get this tag while they have access."
              error={errors.tag}
            />
            <s-stack direction="inline" gap="base">
              <s-button onClick={pickProduct}>
                {product ? "Change product" : "Pick membership product"}
              </s-button>
              <s-text>{product?.title ?? errors.productId ?? ""}</s-text>
            </s-stack>
            <s-text tone="neutral">
              Saving sets every variant of this product to the joining price
              and turns off one-time purchase, so it sells only as a membership.
            </s-text>
            <input type="hidden" name="productId" value={product?.id ?? ""} />
            <s-text-field
              label="Joining price"
              name="joiningPrice"
              error={errors.joiningPrice}
            />
            <s-text-field
              label="Renewal price"
              name="renewalPrice"
              error={errors.renewalPrice}
            />
            <s-select label="Renews every" name="interval" error={errors.interval}>
              <s-option value="YEAR">Years</s-option>
              <s-option value="MONTH">Months</s-option>
            </s-select>
            <s-text-field
              label="Number of years or months"
              name="intervalCount"
              value="1"
              error={errors.intervalCount}
            />
            <s-button
              type="submit"
              variant="primary"
              {...(saving ? { loading: true } : {})}
            >
              Save plan
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { parsePlanForm, type PlanFormErrors } from "../membership/plan";
import { createPlan } from "../membership/plans.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

type ActionResult = {
  errors: PlanFormErrors;
  error: string | null;
  warning: string | null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, redirect } = await authenticate.admin(request);
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
  if (!parsed.ok) {
    return { errors: parsed.errors, error: null, warning: null } satisfies ActionResult;
  }

  const result = await createPlan(admin, session.shop, parsed.plan);
  if (!result.ok) {
    return { errors: {}, error: result.error, warning: null } satisfies ActionResult;
  }
  // The plan is saved but the product needs a hand fix: stay and say so.
  if (result.warning) {
    return { errors: {}, error: null, warning: result.warning } satisfies ActionResult;
  }
  return redirect("/app/plans?created=1");
};

export default function NewPlan() {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [product, setProduct] = useState<{ id: string; title: string } | null>(
    null,
  );
  const result = fetcher.data;
  const errors: PlanFormErrors = result?.errors ?? {};
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
    <s-page heading="Create plan" inlineSize="small">
      <s-link slot="breadcrumb-actions" href="/app/plans">
        Plans
      </s-link>

      {result?.warning && (
        <s-banner tone="warning" heading="The plan is saved">
          {result.warning}
        </s-banner>
      )}
      {result?.error && (
        <s-banner tone="critical" heading="The plan was not saved">
          {result.error}
        </s-banner>
      )}

      <fetcher.Form method="post">
        <s-stack direction="block" gap="base">
          <s-section heading="Plan">
            <s-stack direction="block" gap="base">
              <s-text-field
                label="Plan name"
                name="name"
                placeholder="Coach membership"
                details="Members see this name in the store and at checkout."
                error={errors.name}
              />
              <s-text-field
                label="Customer tag"
                name="tag"
                placeholder="member-coach"
                details="Members get this tag while they have access, and lose it when it ends."
                error={errors.tag}
              />
            </s-stack>
          </s-section>

          <s-section heading="Product">
            <s-stack direction="block" gap="base">
              <s-paragraph color="subdued">
                The product members buy. Saving sets every variant to the
                joining price and turns off one-time purchase, so it sells only
                as a membership.
              </s-paragraph>
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-button onClick={pickProduct}>
                  {product ? "Change product" : "Choose product"}
                </s-button>
                {product && <s-text type="strong">{product.title}</s-text>}
              </s-stack>
              {errors.productId && (
                <s-text tone="critical">{errors.productId}</s-text>
              )}
              <input type="hidden" name="productId" value={product?.id ?? ""} />
            </s-stack>
          </s-section>

          <s-section heading="Pricing">
            <s-stack direction="block" gap="base">
              <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <s-money-field
                  label="Joining price"
                  name="joiningPrice"
                  min={0}
                  details="Charged on the first order."
                  error={errors.joiningPrice}
                />
                <s-money-field
                  label="Renewal price"
                  name="renewalPrice"
                  min={0}
                  details="Charged at every renewal."
                  error={errors.renewalPrice}
                />
              </s-grid>
              <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <s-number-field
                  label="Renews every"
                  name="intervalCount"
                  defaultValue="1"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  error={errors.intervalCount}
                />
                <s-select label="Period" name="interval" error={errors.interval}>
                  <s-option value="YEAR">Years</s-option>
                  <s-option value="MONTH">Months</s-option>
                </s-select>
              </s-grid>
            </s-stack>
          </s-section>

          <s-stack direction="inline" justifyContent="end" gap="base">
            <s-button href="/app/plans">Cancel</s-button>
            <s-button
              type="submit"
              variant="primary"
              {...(saving ? { loading: true } : {})}
            >
              Save plan
            </s-button>
          </s-stack>
        </s-stack>
      </fetcher.Form>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

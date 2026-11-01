import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { parsePlanForm, type PlanFormErrors } from "../membership/plan";
import { parseSeatTypes, seatRowsFromForm } from "../membership/organizations";
import { getPlan, updatePlan } from "../membership/plans.server";
import { PlanFields } from "../components/PlanFields";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const plan = await getPlan(admin, session.shop, params.id ?? "");
  if (!plan) throw new Response("Plan not found", { status: 404 });
  return { plan };
};

type ActionResult = {
  errors: PlanFormErrors;
  error: string | null;
  warning: string | null;
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session, redirect } = await authenticate.admin(request);
  const existing = await getPlan(admin, session.shop, params.id ?? "");
  if (!existing?.product) {
    return { errors: {}, error: "The plan was not found in Shopify.", warning: null } satisfies ActionResult;
  }
  const data = await request.formData();
  const field = (key: string) => String(data.get(key) ?? "");

  const parsed = parsePlanForm({
    name: field("name"),
    tag: field("tag"),
    // The product can't change on an existing plan.
    productId: existing.product.id,
    joiningPrice: field("joiningPrice"),
    renewalPrice: field("renewalPrice"),
    interval: field("interval"),
    intervalCount: field("intervalCount"),
    memberDiscount: field("memberDiscount"),
  });
  if (!parsed.ok) {
    return { errors: parsed.errors, error: null, warning: null } satisfies ActionResult;
  }
  const seats = parseSeatTypes(seatRowsFromForm(field));
  if (!seats.ok) {
    return { errors: {}, error: seats.error, warning: null } satisfies ActionResult;
  }
  const plan = { ...parsed.plan, seatTypes: seats.seatTypes };

  const result = await updatePlan(admin, session.shop, existing.id, plan);
  if (!result.ok) {
    return { errors: {}, error: result.error, warning: null } satisfies ActionResult;
  }
  if (result.warning) {
    return { errors: {}, error: null, warning: result.warning } satisfies ActionResult;
  }
  return redirect("/app/plans?updated=1");
};

export default function EditPlan() {
  const { plan } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const result = fetcher.data;
  const errors: PlanFormErrors = result?.errors ?? {};
  const saving = fetcher.state !== "idle";
  const terms = plan.terms;

  return (
    <s-page heading={plan.name} inlineSize="small">
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

      {!terms || !plan.product ? (
        <s-banner tone="critical" heading="This plan can't be edited here">
          {"Its purchase option was changed or removed outside this app, so " +
            "the app can't read its prices safely. Check the product's " +
            "purchase options in Shopify."}
        </s-banner>
      ) : (
        <fetcher.Form method="post">
          <s-stack direction="block" gap="base">
            <s-banner tone="info">
              Changes apply to people who join from now on. Existing members
              keep the prices and renewal period they signed up with.
            </s-banner>
            <PlanFields
              errors={errors}
              defaults={{
                name: plan.name,
                tag: plan.tag,
                joiningPrice: terms.joiningPrice.toFixed(2),
                renewalPrice: terms.renewalPrice.toFixed(2),
                interval: terms.interval,
                intervalCount: String(terms.intervalCount),
                memberDiscount: plan.memberDiscount ? String(plan.memberDiscount) : "",
                seatTypes: plan.seatTypes,
              }}
              tagLocked={
                plan.memberCount > 0
                  ? `The tag can't change while the plan has members (${plan.memberCount}).`
                  : undefined
              }
              product={
                <s-stack direction="block" gap="small-200">
                  <s-text type="strong">{plan.product.title}</s-text>
                  <s-paragraph color="subdued">
                    {"The product can't change on an existing plan. Saving " +
                      "keeps its price at the joining price."}
                  </s-paragraph>
                </s-stack>
              }
            />
            <s-stack direction="inline" justifyContent="end" gap="base">
              <s-button href="/app/plans">Cancel</s-button>
              <s-button
                type="submit"
                variant="primary"
                {...(saving ? { loading: true } : {})}
              >
                Save changes
              </s-button>
            </s-stack>
          </s-stack>
        </fetcher.Form>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { listPlans } from "../membership/plans.server";
import { parseTypeForm, requirementsFromJson, requirementsToJson } from "../membership/credentials";

// Create (/app/credentials/new) or edit a credential type.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const plans = (await listPlans(session.shop)).map((plan) => ({ id: plan.id, name: plan.name }));
  if (params.id === "new") return { type: null, plans };
  const type = await prisma.credentialType.findFirst({ where: { id: params.id, shop: session.shop } });
  if (!type) throw new Response("Not found", { status: 404 });
  const requirements = requirementsFromJson(type.requirements);
  return {
    plans,
    type: {
      name: type.name,
      code: type.code,
      validityMonths: type.validityMonths,
      tags: requirements.flatMap((r) => (r.kind === "tag" ? [r.tag] : [])).join(", "),
      planIds: requirements.flatMap((r) => (r.kind === "plan" ? [r.planId] : [])),
      needsApproval: type.needsApproval,
      renewalRule: type.renewalRule,
      renewalPlanIds: JSON.parse(type.renewalPlanIds) as string[],
    },
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);
  const data = await request.formData();
  const parsed = parseTypeForm({
    name: String(data.get("name") ?? ""),
    code: String(data.get("code") ?? ""),
    validityMonths: String(data.get("validityMonths") ?? ""),
    tags: String(data.get("tags") ?? ""),
    planIds: data.getAll("planIds").map(String),
    needsApproval: String(data.get("needsApproval") ?? ""),
    renewalRule: String(data.get("renewalRule") ?? ""),
    renewalPlanIds: data.getAll("renewalPlanIds").map(String),
  });
  if (!parsed.ok) return { errors: parsed.errors };
  const value = parsed.value;
  const fields = {
    name: value.name,
    code: value.code,
    validityMonths: value.validityMonths,
    requirements: requirementsToJson(value.requirements),
    needsApproval: value.needsApproval,
    renewalRule: value.renewalRule,
    renewalPlanIds: JSON.stringify(value.renewalPlanIds),
  };
  const clash = await prisma.credentialType.findFirst({
    where: { shop: session.shop, code: value.code, ...(params.id === "new" ? {} : { NOT: { id: params.id } }) },
  });
  if (clash) return { errors: { code: "Another credential uses this code." } };
  if (params.id === "new") {
    await prisma.credentialType.create({ data: { shop: session.shop, ...fields } });
  } else {
    // The code is part of issued numbers and tags, so it can't change once credentials exist.
    const issued = await prisma.credential.count({ where: { typeId: params.id, number: { not: null } } });
    const current = await prisma.credentialType.findFirst({ where: { id: params.id, shop: session.shop } });
    if (!current) throw new Response("Not found", { status: 404 });
    if (issued && current.code !== value.code) {
      return { errors: { code: "Credentials were issued with this code; it can't change." } };
    }
    await prisma.credentialType.update({ where: { id: current.id }, data: fields });
  }
  return redirect("/app/credentials");
};

export default function CredentialTypePage() {
  const { type, plans } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const errors: Record<string, string> = fetcher.data?.errors ?? {};
  const busy = fetcher.state !== "idle";

  return (
    <s-page heading={type ? type.name : "New credential"}>
      <fetcher.Form method="post">
        <s-stack gap="base">
          <s-section heading="Credential">
            <s-stack gap="base">
              <s-text-field label="Name" name="name" defaultValue={type?.name ?? ""} error={errors.name} required></s-text-field>
              <s-text-field
                label="Code"
                name="code"
                defaultValue={type?.code ?? ""}
                details="2 to 12 letters and numbers. Used in credential numbers (COACH1-2026-00001) and the customer tag credential:coach1."
                error={errors.code}
                required
              ></s-text-field>
              <s-number-field
                label="Valid for (months)"
                name="validityMonths"
                defaultValue={String(type?.validityMonths ?? 24)}
                min={0}
                max={120}
                details="0 means it never expires."
                error={errors.validityMonths}
              ></s-number-field>
            </s-stack>
          </s-section>

          <s-section heading="Requirements">
            <s-stack gap="base">
              <s-paragraph>The customer earns the credential when they have every tag and plan chosen here.</s-paragraph>
              <s-text-field
                label="Customer tags"
                name="tags"
                defaultValue={type?.tags ?? ""}
                details="Comma separated. Moodle Bridge tags customers completed:<course short name> when they finish a course."
                error={errors.requirements}
              ></s-text-field>
              {plans.length > 0 && (
                <s-choice-list label="Active membership in" name="planIds" multiple>
                  {plans.map((plan) => (
                    <s-choice key={plan.id} value={plan.id} defaultSelected={type?.planIds.includes(plan.id) ?? false}>
                      {plan.name}
                    </s-choice>
                  ))}
                </s-choice-list>
              )}
              <s-checkbox
                label="An approver checks each one before it's issued"
                name="needsApproval"
                defaultChecked={type?.needsApproval ?? false}
              ></s-checkbox>
            </s-stack>
          </s-section>

          <s-section heading="Membership renewals">
            <s-stack gap="base">
              <s-select label="When a member's credential has lapsed at renewal" name="renewalRule" value={type?.renewalRule ?? "none"} error={errors.renewalRule}>
                <s-option value="none">Renew as usual</s-option>
                <s-option value="flag">Renew, and flag it on the Members page</s-option>
                <s-option value="block">Hold the renewal until the credential is active again</s-option>
              </s-select>
              {plans.length > 0 && (
                <s-choice-list label="For renewals of" name="renewalPlanIds" multiple error={errors.renewalPlanIds}>
                  {plans.map((plan) => (
                    <s-choice key={plan.id} value={plan.id} defaultSelected={type?.renewalPlanIds.includes(plan.id) ?? false}>
                      {plan.name}
                    </s-choice>
                  ))}
                </s-choice-list>
              )}
            </s-stack>
          </s-section>

          <s-button type="submit" variant="primary" loading={busy}>
            Save
          </s-button>
        </s-stack>
      </fetcher.Form>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

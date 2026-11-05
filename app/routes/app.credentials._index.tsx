import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { issue, reject, revoke } from "../membership/credentials.server";
import { requirementsFromJson } from "../membership/credentials";
import { logAccess, openField } from "../membership/dataCrypto.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, sessionToken } = await authenticate.admin(request);
  const shop = session.shop;
  await logAccess(shop, `staff:${sessionToken?.sub ?? "unknown"}`, "viewed credentials (holder names)", "credentials page");
  const [types, pending, recent] = await Promise.all([
    prisma.credentialType.findMany({
      where: { shop },
      orderBy: { name: "asc" },
      include: { _count: { select: { credentials: { where: { status: "ACTIVE" } } } } },
    }),
    prisma.credential.findMany({
      where: { shop, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      include: { type: { select: { name: true } } },
    }),
    prisma.credential.findMany({
      where: { shop, status: { not: "PENDING" } },
      orderBy: { updatedAt: "desc" },
      take: 30,
      include: { type: { select: { name: true } } },
    }),
  ]);
  const appUrl = process.env.SHOPIFY_APP_URL ?? "";
  const row = (c: (typeof recent)[number]) => ({
    id: c.id,
    type: c.type.name,
    customerId: c.customerId.replace("gid://shopify/Customer/", ""),
    holderName: openField(c.holderName),
    status: c.status,
    number: c.number,
    expiresAt: c.expiresAt?.toISOString() ?? null,
    note: c.note,
    verifyUrl: `${appUrl}/verify/${c.verifyCode}`,
  });
  return {
    types: types.map((t) => ({
      id: t.id,
      name: t.name,
      code: t.code,
      validityMonths: t.validityMonths,
      requirements: requirementsFromJson(t.requirements).length,
      needsApproval: t.needsApproval,
      renewalRule: t.renewalRule,
      active: t._count.credentials,
    })),
    pending: pending.map(row),
    recent: recent.map(row),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const note = String(form.get("note") ?? "");
  switch (form.get("intent")) {
    case "approve":
      return { message: (await issue(admin, session.shop, id)) ? "Credential issued." : "It was already decided." };
    case "reject":
      await reject(session.shop, id, note);
      return { message: "Rejected." };
    case "revoke":
      await revoke(admin, session.shop, id, note);
      return { message: "Credential revoked; the customer's credential tag is removed." };
    default:
      return { message: "Unknown action." };
  }
};

const STATUS_TONE: Record<string, "success" | "critical" | "warning" | "neutral"> = {
  ACTIVE: "success",
  EXPIRED: "warning",
  REJECTED: "neutral",
  REVOKED: "critical",
};
const RULES: Record<string, string> = { none: "—", flag: "Flags renewal", block: "Holds renewal" };

export default function Credentials() {
  const { types, pending, recent } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const post = (data: Record<string, string>) => fetcher.submit(data, { method: "post" });

  return (
    <s-page heading="Credentials">
      <s-button slot="primary-action" href="/app/credentials/new">
        New credential
      </s-button>
      {fetcher.data?.message && <s-banner tone="success">{fetcher.data.message}</s-banner>}

      <s-section heading={`Waiting for approval (${pending.length})`}>
        {pending.length === 0 ? (
          <s-paragraph color="subdued">Nothing to approve.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Customer</s-table-header>
              <s-table-header>Credential</s-table-header>
              <s-table-header></s-table-header>
            </s-table-header-row>
            <s-table-body>
              {pending.map((c) => (
                <s-table-row key={c.id}>
                  <s-table-cell>
                    <s-link href={`shopify://admin/customers/${c.customerId}`}>{c.holderName}</s-link>
                  </s-table-cell>
                  <s-table-cell>{c.type}</s-table-cell>
                  <s-table-cell>
                    <s-button-group>
                      <s-button variant="primary" onClick={() => post({ intent: "approve", id: c.id })}>
                        Approve
                      </s-button>
                      <s-button tone="critical" onClick={() => post({ intent: "reject", id: c.id })}>
                        Reject
                      </s-button>
                    </s-button-group>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="Credential types">
        {types.length === 0 ? (
          <s-paragraph color="subdued">
            None yet. A credential is earned from customer tags (a completed Moodle course, for example) and/or a
            membership plan, and can hold or flag renewals when it lapses.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Name</s-table-header>
              <s-table-header>Valid for</s-table-header>
              <s-table-header>Approval</s-table-header>
              <s-table-header>At renewal</s-table-header>
              <s-table-header listSlot="secondary">Active</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {types.map((t) => (
                <s-table-row key={t.id}>
                  <s-table-cell>
                    <s-link href={`/app/credentials/${t.id}`}>
                      {t.name} ({t.code})
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{t.validityMonths ? `${t.validityMonths} months` : "No expiry"}</s-table-cell>
                  <s-table-cell>{t.needsApproval ? "Approver" : "Automatic"}</s-table-cell>
                  <s-table-cell>{RULES[t.renewalRule] ?? t.renewalRule}</s-table-cell>
                  <s-table-cell>{t.active}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="Recent">
        {recent.length === 0 ? (
          <s-paragraph color="subdued">No credentials issued yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Number</s-table-header>
              <s-table-header>Holder</s-table-header>
              <s-table-header>Credential</s-table-header>
              <s-table-header>Expires</s-table-header>
              <s-table-header listSlot="secondary">Status</s-table-header>
              <s-table-header></s-table-header>
            </s-table-header-row>
            <s-table-body>
              {recent.map((c) => (
                <s-table-row key={c.id}>
                  <s-table-cell>
                    {c.number ? (
                      <s-link href={c.verifyUrl} target="_blank">
                        {c.number}
                      </s-link>
                    ) : (
                      "—"
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    <s-link href={`shopify://admin/customers/${c.customerId}`}>{c.holderName}</s-link>
                  </s-table-cell>
                  <s-table-cell>{c.type}</s-table-cell>
                  <s-table-cell>{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "—"}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={STATUS_TONE[c.status] ?? "neutral"}>{c.status.toLowerCase()}</s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    {c.status === "ACTIVE" && (
                      <s-button variant="tertiary" tone="critical" onClick={() => post({ intent: "revoke", id: c.id })}>
                        Revoke
                      </s-button>
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

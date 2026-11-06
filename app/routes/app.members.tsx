import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { refreshSchedule, renewNow, runRenewals } from "../membership/renewals.server";
import { logAccess } from "../membership/dataCrypto.server";

const CUSTOMERS = `#graphql
  query membershipCustomers($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Customer {
        id
        displayName
      }
    }
  }`;

// The order each membership was bought with, for a link to it in the admin.
const ORIGIN_ORDERS = `#graphql
  query membershipOriginOrders($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on SubscriptionContract {
        id
        originOrder {
          id
          name
        }
      }
    }
  }`;

type Admin = Awaited<ReturnType<typeof authenticate.admin>>["admin"];

/** Shopify's `nodes` takes up to 250 ids per call. */
async function readNodes(admin: Admin, query: string, ids: string[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodes: any[] = [];
  for (let i = 0; i < ids.length; i += 250) {
    const body = await (
      await admin.graphql(query, { variables: { ids: ids.slice(i, i + 250) } })
    ).json();
    nodes.push(...(body.data?.nodes ?? []).filter(Boolean));
  }
  return nodes;
}

const dateFormat: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, sessionToken } = await authenticate.admin(request);
  const where = { shop: session.shop };
  await logAccess(session.shop, `staff:${sessionToken?.sub ?? "unknown"}`, "viewed members (names)", "members page");

  // Memberships from before the schedule was stored get it on first view.
  const missing = await prisma.membership.findMany({
    where: { ...where, contractStatus: "ACTIVE", nextRenewalAt: null },
    select: { id: true },
    take: 20,
  });
  for (const { id } of missing) {
    try {
      await refreshSchedule(admin, id);
    } catch (error) {
      console.error(`schedule refresh for membership ${id} failed:`, error);
    }
  }

  const memberships = await prisma.membership.findMany({
    where,
    include: {
      plan: { select: { name: true } },
      billingAttempts: {
        where: { state: "SUCCEEDED" },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { updatedAt: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Names are protected customer data; without access, show the customer id.
  const names = new Map<string, string>();
  const ids = [...new Set(memberships.map((m) => m.customerId))];
  try {
    for (const node of await readNodes(admin, CUSTOMERS, ids)) {
      if (node.id && node.displayName) names.set(node.id, node.displayName);
    }
  } catch {
    // Fall back to ids below.
  }

  const orders = new Map<string, { id: string; name: string }>();
  try {
    const contracts = memberships.map((m) => m.contractId);
    for (const node of await readNodes(admin, ORIGIN_ORDERS, contracts)) {
      if (node.id && node.originOrder) orders.set(node.id, node.originOrder);
    }
  } catch {
    // The order column stays empty.
  }

  return {
    members: memberships.map((m) => ({
      id: m.id,
      customer: names.get(m.customerId) ?? m.customerId.split("/").pop() ?? m.customerId,
      customerAdminId: m.customerId.split("/").pop() ?? "",
      plan: m.plan.name,
      order: orders.has(m.contractId)
        ? {
            name: orders.get(m.contractId)!.name,
            adminId: orders.get(m.contractId)!.id.split("/").pop() ?? "",
          }
        : null,
      status: m.status,
      failedAttempts: m.failedAttempts,
      nextAttemptAt: m.nextAttemptAt?.toLocaleDateString("en-US", dateFormat) ?? null,
      since: m.createdAt.toLocaleDateString("en-US", dateFormat),
      credentialIssue: m.credentialIssue,
      // Before lastPaidAt was stored: the latest paid renewal, else the
      // joining payment at purchase.
      lastPaid: (
        m.lastPaidAt ?? m.billingAttempts[0]?.updatedAt ?? m.createdAt
      ).toLocaleDateString("en-US", dateFormat),
      nextRenewal: m.nextRenewalAt?.toLocaleDateString("en-US", dateFormat) ?? null,
      accessEndsAt:
        m.status === "ENDING"
          ? m.accessEndsAt?.toLocaleDateString("en-US", dateFormat) ?? null
          : null,
      nextAmount:
        m.nextRenewalAmount && m.currency
          ? new Intl.NumberFormat("en-US", { style: "currency", currency: m.currency }).format(
              Number(m.nextRenewalAmount),
            )
          : m.nextRenewalAmount,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const data = await request.formData();

  if (data.get("intent") === "renew") {
    const id = String(data.get("membershipId") ?? "");
    const owned = await prisma.membership.findFirst({ where: { id, shop: session.shop } });
    if (!owned) return { message: "Member not found.", tone: "critical" as const };
    let result;
    try {
      result = await renewNow(admin, id);
    } catch (error) {
      console.error(`Renew now for membership ${id} failed:`, error);
      return {
        message: `Shopify refused: ${error instanceof Error ? error.message : "unknown error"}`,
        tone: "critical" as const,
      };
    }
    return result.charged
      ? { message: "Renewal charge sent. The result appears here in a moment.", tone: "success" as const }
      : { message: `No charge: ${result.reason}.`, tone: "warning" as const };
  }

  const results = await runRenewals(admin, session.shop);
  const charged = results.filter((r) => r.result.charged).length;
  return {
    message: `${charged} renewal charge${charged === 1 ? "" : "s"} sent.`,
    tone: "info" as const,
  };
};

const STATUS_TONE: Record<string, "success" | "warning" | "critical" | "neutral"> = {
  ACTIVE: "success",
  PAST_DUE: "warning",
  ENDING: "warning",
  LAPSED: "critical",
  CANCELLED: "neutral",
  PAUSED: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  PAST_DUE: "Past due",
  ENDING: "Ending",
  LAPSED: "Lapsed",
  CANCELLED: "Cancelled",
  PAUSED: "Paused",
};

export default function Members() {
  const { members } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";

  return (
    <s-page heading="Members">
      <fetcher.Form method="post" slot="primary-action">
        <input type="hidden" name="intent" value="run" />
        <s-button type="submit" {...(busy ? { loading: true } : {})}>
          Run due renewals
        </s-button>
      </fetcher.Form>

      {fetcher.data && (
        <s-banner tone={fetcher.data.tone}>{fetcher.data.message}</s-banner>
      )}

      {members.length === 0 ? (
        <s-section accessibilityLabel="No members yet">
          <s-stack direction="block" gap="base" alignItems="center" padding="large">
            <s-icon type="person" />
            <s-heading>No members yet</s-heading>
            <s-paragraph color="subdued">
              Members appear here after they buy a plan in your store.
            </s-paragraph>
          </s-stack>
        </s-section>
      ) : (
        <s-section padding="none" accessibilityLabel="Members">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Member</s-table-header>
              <s-table-header listSlot="labeled">Plan</s-table-header>
              <s-table-header listSlot="labeled">Status</s-table-header>
              <s-table-header listSlot="labeled">Member since</s-table-header>
              <s-table-header listSlot="labeled">Order</s-table-header>
              <s-table-header listSlot="labeled">Last paid</s-table-header>
              <s-table-header listSlot="labeled">Next renewal</s-table-header>
              <s-table-header listSlot="labeled">Charge</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {members.map((m) => (
                <s-table-row key={m.id}>
                  <s-table-cell>
                    <s-link href={`shopify://admin/customers/${m.customerAdminId}`}>
                      {m.customer}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{m.plan}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={STATUS_TONE[m.status] ?? "neutral"}>
                      {STATUS_LABEL[m.status] ?? m.status}
                    </s-badge>
                    {m.failedAttempts > 0 && (
                      <s-text color="subdued">
                        {" "}
                        {m.failedAttempts} failed
                        {m.nextAttemptAt ? `, retry ${m.nextAttemptAt}` : ""}
                      </s-text>
                    )}
                    {m.accessEndsAt && (
                      <s-text color="subdued"> access until {m.accessEndsAt}</s-text>
                    )}
                    {m.credentialIssue && (
                      <s-text tone="critical"> {m.credentialIssue}</s-text>
                    )}
                  </s-table-cell>
                  <s-table-cell>{m.since}</s-table-cell>
                  <s-table-cell>
                    {m.order ? (
                      <s-link href={`shopify://admin/orders/${m.order.adminId}`}>{m.order.name}</s-link>
                    ) : (
                      "—"
                    )}
                  </s-table-cell>
                  <s-table-cell>{m.lastPaid ?? "—"}</s-table-cell>
                  <s-table-cell>
                    {m.nextRenewal ? (
                      <s-stack direction="block" gap="none">
                        <s-text>{m.nextRenewal}</s-text>
                        {m.nextAmount && <s-text color="subdued">{m.nextAmount}</s-text>}
                      </s-stack>
                    ) : (
                      "—"
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="renew" />
                      <input type="hidden" name="membershipId" value={m.id} />
                      <s-button type="submit" variant="tertiary">
                        Renew now
                      </s-button>
                    </fetcher.Form>
                  </s-table-cell>
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

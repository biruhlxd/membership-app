import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  checkRows,
  FIELD_LABELS,
  guessColumns,
  IMPORT_FIELDS,
  parseCsv,
  planValues,
  suggestPlanId,
  type ColumnMap,
  type ImportRow,
} from "../membership/import";
import { importRow, planSetup, type PlanSetup } from "../membership/import.server";
import { logAccess } from "../membership/dataCrypto.server";

// Moving members in from Appstle: upload its subscription export, confirm the
// columns and plans, check, then import. Each run creates at most RUN_LIMIT
// contracts so the request finishes; running again continues where it
// stopped (imported contracts are skipped).
const SOURCE = "appstle";
const RUN_LIMIT = 50;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const [plans, imports] = await Promise.all([
    prisma.membershipPlan.findMany({ where: { shop }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.contractImport.findMany({
      where: { shop, source: SOURCE },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: { sourceId: true, customerId: true, status: true, error: true, updatedAt: true },
    }),
  ]);
  return {
    plans,
    imports: imports.map((i) => ({
      ...i,
      customerId: i.customerId?.split("/").pop() ?? null,
      updatedAt: i.updatedAt.toISOString(),
    })),
  };
};

type Plans = { id: string; name: string }[];

function readForm(form: FormData, plans: Plans) {
  const map = {} as ColumnMap;
  for (const field of IMPORT_FIELDS) map[field] = Number(form.get(`col_${field}`) ?? -1);
  const matched = new Map<string, string>();
  for (const [name, value] of form.entries()) {
    if (name.startsWith("plan_") && plans.some((p) => p.id === value)) {
      matched.set(name.slice(5), String(value));
    }
  }
  return { map, planOf: (plan: string) => matched.get(plan) ?? null };
}

/** A plan's id from the file's plan value, when the names clearly match (import.ts, suggestPlan). */
function suggestPlan(value: string, plans: Plans) {
  return suggestPlanId(value, plans) ?? "";
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, sessionToken } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const [headers = [], ...rows] = parseCsv(String(form.get("csv") ?? ""));
  if (headers.length === 0 || rows.length === 0) {
    return { intent, error: "The file has no rows. Upload Appstle's subscription export (CSV)." };
  }
  const plans = await prisma.membershipPlan.findMany({ where: { shop }, select: { id: true, name: true } });

  if (intent === "read") {
    const guess = guessColumns(headers);
    return {
      intent,
      headers,
      guess,
      planValues: planValues(rows, guess).map((value) => ({ value, suggested: suggestPlan(value, plans) })),
    };
  }

  const { map, planOf } = readForm(form, plans);
  if (map.sourceId < 0 || map.plan < 0 || map.nextBillingDate < 0 || (map.email < 0 && map.customerId < 0)) {
    return { intent, error: "Choose the contract ID, plan, next billing date, and customer email or ID columns." };
  }
  const today = new Date().toISOString().slice(0, 10);
  const checked = checkRows(rows, map, planOf, today);
  const done = new Set(
    (
      await prisma.contractImport.findMany({
        where: { shop, source: SOURCE, status: "DONE", sourceId: { in: checked.map((r) => r.sourceId) } },
        select: { sourceId: true },
      })
    ).map((r) => r.sourceId),
  );
  for (const row of checked) if (done.has(row.sourceId)) row.problems.push("already imported");
  const ready = checked.filter((r) => r.problems.length === 0);

  if (intent === "check") {
    return { intent, rows: checked.map(rowView), ready: ready.length };
  }

  // intent === "import"
  await logAccess(shop, `staff:${sessionToken?.sub ?? "unknown"}`, `imported members from ${SOURCE}`, `${Math.min(ready.length, RUN_LIMIT)} contracts`);
  const setups = new Map<string, PlanSetup | null>();
  const results: { line: number; sourceId: string; outcome: string; ok: boolean }[] = [];
  for (const row of ready.slice(0, RUN_LIMIT)) {
    const planId = planOf(row.plan)!;
    if (!setups.has(planId)) setups.set(planId, await planSetup(admin, shop, planId));
    const setup = setups.get(planId);
    if (!setup) {
      results.push({ line: row.line, sourceId: row.sourceId, ok: false, outcome: "the plan can't be read from Shopify" });
      continue;
    }
    try {
      const result = await importRow(admin, shop, SOURCE, row, setup);
      results.push({
        line: row.line,
        sourceId: row.sourceId,
        ok: result.imported,
        outcome: result.imported ? "imported" : result.reason,
      });
    } catch (error) {
      console.error(`import of ${SOURCE} contract ${row.sourceId} for ${shop} failed:`, error);
      results.push({ line: row.line, sourceId: row.sourceId, ok: false, outcome: "failed; see the app log" });
    }
  }
  return { intent, results, remaining: Math.max(0, ready.length - RUN_LIMIT) };
};

function rowView(r: ImportRow) {
  return {
    line: r.line,
    sourceId: r.sourceId,
    customer: r.email ?? r.customerId?.split("/").pop() ?? "",
    plan: r.plan,
    nextBillingDate: r.nextBillingDate,
    price: r.price,
    problems: r.problems,
  };
}

type ActionData = {
  intent: string;
  error?: string;
  headers?: string[];
  guess?: ColumnMap;
  planValues?: { value: string; suggested: string }[];
  rows?: ReturnType<typeof rowView>[];
  ready?: number;
  results?: { line: number; sourceId: string; outcome: string; ok: boolean }[];
  remaining?: number;
};

export default function Import() {
  const { plans, imports } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  // The column and plan choices come from the "read" answer and stay while
  // the merchant checks and imports.
  const [setup, setSetup] = useState<ActionData | null>(null);
  const data = fetcher.data;
  if (data?.intent === "read" && data.headers && data !== setup) setSetup(data);
  const busy = fetcher.state !== "idle";

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    setSetup(null);
    fetcher.submit({ intent: "read", csv: text }, { method: "post" });
  };

  const submit = (intent: "check" | "import") => {
    const form = document.getElementById("import-form") as HTMLFormElement;
    const body = new FormData(form);
    body.set("intent", intent);
    body.set("csv", csv);
    fetcher.submit(body, { method: "post" });
  };

  return (
    <s-page heading="Import from Appstle">
      <s-section>
        <s-paragraph>
          Move your Appstle subscribers here without asking them to sign up again. Each active subscriber gets a
          membership on the plan you choose, charged to the card they already saved, on the same next billing date
          and at their renewal price. Nobody is charged now, and imported members get no welcome email.
        </s-paragraph>
        <s-paragraph>
          After the import, cancel the moved subscriptions in Appstle without a refund. First, turn off Appstle&apos;s
          setting that removes customer tags when a subscription is cancelled, so members keep their access.
        </s-paragraph>
      </s-section>

      <s-section heading="1. Upload Appstle's export">
        <s-paragraph>In Appstle, export all subscriptions as CSV, then choose the file here.</s-paragraph>
        <input type="file" accept=".csv,text/csv" onChange={onFile} aria-label="Appstle export (CSV)" />
        {fileName && <s-paragraph color="subdued">{fileName}</s-paragraph>}
      </s-section>

      {data?.error && <s-banner tone="critical">{data.error}</s-banner>}

      {setup?.headers && setup.guess && (
        <form id="import-form" key={fileName} onSubmit={(e) => e.preventDefault()}>
          <s-section heading="2. Confirm the columns">
            <s-stack gap="base">
              {IMPORT_FIELDS.map((field) => (
                <s-select
                  key={field}
                  label={FIELD_LABELS[field]}
                  name={`col_${field}`}
                  value={String(setup.guess![field])}
                  details={
                    field === "status"
                      ? "Only active subscriptions are imported."
                      : field === "price"
                        ? "Optional. Without it, members renew at the plan's renewal price."
                        : field === "email" || field === "customerId"
                          ? "One of these two is enough."
                          : undefined
                  }
                >
                  <s-option value="-1">None</s-option>
                  {setup.headers!.map((h, i) => (
                    <s-option key={i} value={String(i)}>
                      {h}
                    </s-option>
                  ))}
                </s-select>
              ))}
            </s-stack>
          </s-section>

          <s-section heading="3. Match the plans">
            {plans.length === 0 ? (
              <s-paragraph>
                Create your plans first, on the <s-link href="/app/plans">Plans</s-link> page.
              </s-paragraph>
            ) : setup.planValues!.length === 0 ? (
              <s-paragraph color="subdued">
                No plans found in the plan column. Check the columns above.
              </s-paragraph>
            ) : (
              <s-stack gap="base">
                {setup.planValues!.map((p) => (
                  <s-select key={p.value} label={`Appstle: ${p.value}`} name={`plan_${p.value}`} value={p.suggested}>
                    <s-option value="">Don&apos;t import</s-option>
                    {plans.map((plan) => (
                      <s-option key={plan.id} value={plan.id}>
                        {plan.name}
                      </s-option>
                    ))}
                  </s-select>
                ))}
              </s-stack>
            )}
          </s-section>

          <s-section heading="4. Check, then import">
            <s-stack direction="inline" gap="base">
              <s-button onClick={() => submit("check")} loading={busy && fetcher.formData?.get("intent") === "check"}>
                Check
              </s-button>
              {data?.intent === "check" && (data.ready ?? 0) > 0 && (
                <s-button
                  variant="primary"
                  onClick={() => submit("import")}
                  loading={busy && fetcher.formData?.get("intent") === "import"}
                >
                  {`Import ${Math.min(data.ready!, RUN_LIMIT)} member${data.ready === 1 ? "" : "s"}`}
                </s-button>
              )}
            </s-stack>
          </s-section>
        </form>
      )}

      {data?.intent === "check" && data.rows && (
        <s-section heading={`${data.ready} of ${data.rows.length} active subscriptions ready`}>
          {(data.ready ?? 0) > RUN_LIMIT && (
            <s-paragraph>
              {`Each run imports ${RUN_LIMIT}. Run it again for the rest; imported ones are skipped.`}
            </s-paragraph>
          )}
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Customer</s-table-header>
              <s-table-header>Plan</s-table-header>
              <s-table-header>Next billing</s-table-header>
              <s-table-header>Price</s-table-header>
              <s-table-header listSlot="secondary">Result</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.rows.map((r) => (
                <s-table-row key={r.line}>
                  <s-table-cell>{r.customer}</s-table-cell>
                  <s-table-cell>{r.plan}</s-table-cell>
                  <s-table-cell>{r.nextBillingDate ?? ""}</s-table-cell>
                  <s-table-cell>{r.price ?? "plan's renewal price"}</s-table-cell>
                  <s-table-cell>
                    {r.problems.length === 0 ? (
                      <s-badge tone="success">Ready</s-badge>
                    ) : (
                      <s-text color="subdued">{`Skipped: ${r.problems.join("; ")}`}</s-text>
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}

      {data?.intent === "import" && data.results && (
        <s-section heading="Import results">
          <s-banner tone={data.results.every((r) => r.ok) ? "success" : "warning"}>
            {`${data.results.filter((r) => r.ok).length} imported, ${data.results.filter((r) => !r.ok).length} not.`}
            {(data.remaining ?? 0) > 0 && ` ${data.remaining} still to do: press Check, then Import again.`}
          </s-banner>
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Appstle contract</s-table-header>
              <s-table-header listSlot="secondary">Result</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.results.map((r) => (
                <s-table-row key={r.line}>
                  <s-table-cell>{r.sourceId}</s-table-cell>
                  <s-table-cell>{r.outcome}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}

      <s-section heading="Imported so far">
        {imports.length === 0 ? (
          <s-paragraph color="subdued">None yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Appstle contract</s-table-header>
              <s-table-header>Customer</s-table-header>
              <s-table-header listSlot="secondary">Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {imports.map((i) => (
                <s-table-row key={i.sourceId}>
                  <s-table-cell>{i.sourceId}</s-table-cell>
                  <s-table-cell>
                    {i.customerId ? (
                      <s-link href={`shopify://admin/customers/${i.customerId}`}>{`Customer ${i.customerId}`}</s-link>
                    ) : (
                      ""
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    {i.status === "DONE" ? "Imported" : i.status === "PENDING" ? "Stopped part way" : i.error}
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

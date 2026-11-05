import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { customerData } from "../membership/privacy.server";
import { logAccess } from "../membership/dataCrypto.server";

// Customers' data requests (Shopify's customers/data_request webhook): the
// merchant downloads what the app holds about the customer and sends it to
// them. Each download is recorded in the access log.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, sessionToken } = await authenticate.admin(request);
  const shop = session.shop;
  const download = new URL(request.url).searchParams.get("download");
  if (download) {
    const row = await prisma.dataRequest.findFirst({ where: { shop, id: download } });
    if (!row) throw new Response("Not found", { status: 404 });
    const data = await customerData(shop, row.customerId);
    await prisma.dataRequest.update({ where: { id: row.id }, data: { downloadedAt: new Date() } });
    await logAccess(shop, `staff:${sessionToken?.sub ?? "unknown"}`, "downloaded a customer's data (data request)", row.customerId);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="customer-${row.customerId}-data.json"`,
        "Cache-Control": "no-store",
      },
    });
  }
  const requests = await prisma.dataRequest.findMany({ where: { shop }, orderBy: { receivedAt: "desc" }, take: 50 });
  return {
    requests: requests.map((r) => ({
      id: r.id,
      customerId: r.customerId,
      receivedAt: r.receivedAt.toISOString(),
      downloadedAt: r.downloadedAt?.toISOString() ?? null,
    })),
  };
};

export default function PrivacyRequests() {
  const { requests } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Privacy requests">
      <s-section>
        <s-paragraph>
          When a customer asks your store for their data, Shopify sends the request here. Download what Biruh
          Membership holds about them and send it to the customer within 30 days. Deletion requests are handled
          automatically.
        </s-paragraph>
      </s-section>
      <s-section heading="Data requests">
        {requests.length === 0 ? (
          <s-paragraph color="subdued">None.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Customer</s-table-header>
              <s-table-header>Received</s-table-header>
              <s-table-header listSlot="secondary">Downloaded</s-table-header>
              <s-table-header></s-table-header>
            </s-table-header-row>
            <s-table-body>
              {requests.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>
                    <s-link href={`shopify://admin/customers/${r.customerId}`}>Customer {r.customerId}</s-link>
                  </s-table-cell>
                  <s-table-cell>{new Date(r.receivedAt).toLocaleDateString()}</s-table-cell>
                  <s-table-cell>{r.downloadedAt ? new Date(r.downloadedAt).toLocaleDateString() : "Not yet"}</s-table-cell>
                  <s-table-cell>
                    <s-button variant="tertiary" href={`/app/privacy-requests?download=${r.id}`} target="_blank">
                      Download
                    </s-button>
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

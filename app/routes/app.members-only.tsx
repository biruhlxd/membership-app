import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  membersOnlyProducts,
  setMembersOnly,
  syncMembersOnly,
} from "../membership/membersOnly.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  let rule: { ok: boolean; message: string | null; enabled: boolean };
  try {
    const synced = await syncMembersOnly(admin, session.shop);
    rule = { ok: true, message: null, enabled: synced.enabled };
  } catch (error) {
    console.error("members-only rule failed:", error);
    rule = {
      ok: false,
      message: error instanceof Error ? error.message : "Shopify refused it",
      enabled: false,
    };
  }
  return { products: await membersOnlyProducts(admin), rule };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const data = await request.formData();
  const ids = data.getAll("productId").map(String).filter(Boolean);
  const on = data.get("intent") === "add";
  try {
    await setMembersOnly(admin, ids, on);
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Shopify refused it" };
  }
};

export default function MembersOnly() {
  const { products, rule } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const addProducts = async () => {
    const picked = await shopify.resourcePicker({ type: "product", multiple: true });
    if (!picked?.length) return;
    const form = new FormData();
    form.set("intent", "add");
    for (const p of picked) form.append("productId", p.id);
    fetcher.submit(form, { method: "post" });
  };

  return (
    <s-page heading="Members-only products">
      <s-button slot="primary-action" variant="primary" onClick={addProducts}>
        Add products
      </s-button>

      {!rule.ok && (
        <s-banner tone="critical" heading="The members-only rule isn't active">
          {rule.message}
        </s-banner>
      )}
      {rule.ok && !rule.enabled && (
        <s-banner tone="warning" heading="The members-only rule is turned off">
          Turn it on in Settings, Checkout, Checkout rules.
        </s-banner>
      )}
      {fetcher.data?.error && <s-banner tone="critical">{fetcher.data.error}</s-banner>}

      <s-section>
        <s-paragraph color="subdued">
          Only logged-in customers with a membership plan&apos;s tag can buy these
          products; checkout stops anyone else. Products here carry the tag
          &quot;members-only&quot;, so you can also add it on the product page.
        </s-paragraph>
      </s-section>

      {products.length === 0 ? (
        <s-section accessibilityLabel="No members-only products yet">
          <s-stack direction="block" gap="base" alignItems="center" padding="large">
            <s-icon type="lock" />
            <s-heading>No members-only products yet</s-heading>
            <s-button variant="primary" onClick={addProducts}>
              Add products
            </s-button>
          </s-stack>
        </s-section>
      ) : (
        <s-section padding="none" accessibilityLabel="Members-only products">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Product</s-table-header>
              <s-table-header listSlot="labeled">Status</s-table-header>
              <s-table-header listSlot="labeled">Access</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {products.map((p) => (
                <s-table-row key={p.id}>
                  <s-table-cell>
                    <s-link href={`shopify://admin/products/${p.id.split("/").pop()}`}>
                      {p.title}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge>{p.status.charAt(0) + p.status.slice(1).toLowerCase()}</s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="remove" />
                      <input type="hidden" name="productId" value={p.id} />
                      <s-button type="submit" variant="tertiary">
                        Open to everyone
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

// The member portal (a customer account extension) calls this app's server,
// whose address differs between the live app (https://app.biruh.org) and
// development (a tunnel that changes on every start). So the app writes its
// own address to an app-owned shop metafield ($app.app_url, declared in
// shopify.app.toml with customer account read access), and the portal reads
// it before calling.
//
// Both operations are validated against the 2026-10 Admin API schema.
import type { Admin } from "./plans.server";

const READ = `#graphql
  query membershipShopAppUrl {
    shop {
      id
      metafield(namespace: "$app", key: "app_url") {
        value
      }
    }
  }`;

const WRITE = `#graphql
  mutation membershipSetAppUrl($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }`;

// Shops already checked by this server process.
const checked = new Set<string>();

/** Make sure the shop's $app.app_url holds this server's address. */
export async function ensureAppUrl(admin: Admin, shop: string) {
  const url = process.env.SHOPIFY_APP_URL;
  if (!url || checked.has(`${shop} ${url}`)) return;
  try {
    const data = (await (await admin.graphql(READ)).json()).data;
    if (data?.shop?.metafield?.value !== url) {
      const result = (
        await (
          await admin.graphql(WRITE, {
            variables: {
              metafields: [
                { ownerId: data.shop.id, namespace: "$app", key: "app_url", type: "url", value: url },
              ],
            },
          })
        ).json()
      ).data?.metafieldsSet;
      if (result?.userErrors?.length) {
        console.error(`app address for ${shop} not saved:`, result.userErrors);
        return;
      }
    }
    checked.add(`${shop} ${url}`);
  } catch (error) {
    console.error(`app address for ${shop} not saved:`, error);
  }
}

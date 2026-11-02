import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { evaluateCustomer } from "../membership/credentials.server";

// customers/update: a customer's tags changed (for example Moodle Bridge
// tagged a completed course), so they may now qualify for a credential.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, admin } = await authenticate.webhook(request);
  if (!admin) return new Response();
  const body = payload as {
    admin_graphql_api_id?: string;
    tags?: string;
    first_name?: string | null;
    last_name?: string | null;
  };
  if (!body.admin_graphql_api_id) return new Response();
  try {
    await evaluateCustomer(admin, shop, body.admin_graphql_api_id, {
      tags: (body.tags ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
      firstName: body.first_name ?? null,
      lastName: body.last_name ?? null,
    });
  } catch (error) {
    console.error(`credentials for ${body.admin_graphql_api_id} on ${shop} failed:`, error);
    return new Response(null, { status: 500 });
  }
  return new Response();
};

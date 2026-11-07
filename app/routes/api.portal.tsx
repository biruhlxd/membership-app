import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate, unauthenticated } from "../shopify.server";
import {
  answerInvitation,
  endSeat,
  inviteToSeat,
  portalState,
} from "../membership/organizations.server";

// Called by the member portal (customer account extension) with Shopify's
// session token. The customer is the token's `sub` and the shop its `dest`;
// nothing in the request body can name a different customer.
async function caller(request: Request) {
  const { sessionToken, cors } = await authenticate.public.customerAccount(request);
  const shop = String(sessionToken.dest).replace(/^https?:\/\//, "");
  const customerId = String(sessionToken.sub ?? "");
  const { admin } = await unauthenticated.admin(shop);
  return { shop, customerId, admin, cors };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, customerId, admin, cors } = await caller(request);
  if (!customerId) return cors(Response.json({ error: "Not logged in." }, { status: 401 }));
  // Ticks "Add the Membership page" in the setup guide; never blocks the page.
  await prisma.shopSetup
    .upsert({ where: { shop }, create: { shop, portalSeenAt: new Date() }, update: {} })
    .catch((error) => console.error(`portal seen for ${shop}:`, error));
  return cors(Response.json(await portalState(admin, shop, customerId)));
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, customerId, admin, cors } = await caller(request);
  if (!customerId) return cors(Response.json({ error: "Not logged in." }, { status: 401 }));

  const body = (await request.json().catch(() => ({}))) as Record<string, string>;
  let result;
  switch (body.intent) {
    case "invite":
      result = await inviteToSeat(admin, shop, customerId, {
        organizationId: body.organizationId ?? "",
        email: body.email ?? "",
        tag: body.tag ?? "",
      });
      break;
    case "endSeat":
      result = await endSeat(admin, shop, customerId, body.seatId ?? "");
      break;
    case "accept":
    case "decline":
      result = await answerInvitation(admin, shop, customerId, body.seatId ?? "", body.intent === "accept");
      break;
    default:
      result = { ok: false, error: "Unknown action." };
  }
  return cors(Response.json(result, { status: result.ok ? 200 : 400 }));
};

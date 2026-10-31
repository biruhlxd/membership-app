import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { runRenewals } from "../membership/renewals.server";

// POST /jobs/renewals — called by a scheduler (for example once an hour) with
// "Authorization: Bearer <RENEWALS_JOB_SECRET>". Charges every due renewal in
// every shop that has the app installed. Off unless the secret is set.
export const action = async ({ request }: ActionFunctionArgs) => {
  const secret = process.env.RENEWALS_JOB_SECRET;
  if (!secret || request.headers.get("Authorization") !== `Bearer ${secret}`) {
    return new Response("Not found", { status: 404 });
  }

  const shops = await prisma.session.findMany({
    where: { isOnline: false },
    select: { shop: true },
    distinct: ["shop"],
  });
  const summary: Record<string, number> = {};
  for (const { shop } of shops) {
    try {
      const { admin } = await unauthenticated.admin(shop);
      const results = await runRenewals(admin, shop);
      summary[shop] = results.filter((r) => r.result.charged).length;
    } catch (error) {
      console.error(`renewal job for ${shop} failed:`, error);
      summary[shop] = -1;
    }
  }
  return Response.json({ charged: summary });
};

export const loader = () => new Response("Not found", { status: 404 });

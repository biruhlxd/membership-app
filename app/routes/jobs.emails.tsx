import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { sendDueWelcomes } from "../membership/emails.server";

// POST /jobs/emails — called every few minutes with
// "Authorization: Bearer <RENEWALS_JOB_SECRET>". Sends welcomes that waited
// for Moodle's "account ready" long enough (emails.server.ts, WELCOME_WAIT_MS).
export const action = async ({ request }: ActionFunctionArgs) => {
  const secret = process.env.RENEWALS_JOB_SECRET;
  if (!secret || request.headers.get("Authorization") !== `Bearer ${secret}`) {
    return new Response("Not found", { status: 404 });
  }
  const waiting = await prisma.membership.findMany({
    where: { welcomeDueAt: { lte: new Date() } },
    select: { shop: true },
    distinct: ["shop"],
  });
  const summary: Record<string, number> = {};
  for (const { shop } of waiting) {
    try {
      const { admin } = await unauthenticated.admin(shop);
      summary[shop] = await sendDueWelcomes(admin, shop);
    } catch (error) {
      console.error(`email job for ${shop} failed:`, error);
      summary[shop] = -1;
    }
  }
  return Response.json({ welcomes: summary });
};

export const loader = () => new Response("Not found", { status: 404 });

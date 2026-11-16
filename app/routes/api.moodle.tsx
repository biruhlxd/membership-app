import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { handleMoodleMessage, verifyMoodleMessage } from "../membership/moodleLink.server";

// POST /api/moodle — signed messages from the store's Moodle site
// (moodleLink.server.ts). Off unless MOODLE_LINK_SECRET is set. 401 for a bad
// signature, 404 for a shop without the app; 500 makes Moodle retry.
export const action = async ({ request }: ActionFunctionArgs) => {
  const secret = process.env.MOODLE_LINK_SECRET;
  if (!secret) return new Response("Not found", { status: 404 });
  let message = "";
  try {
    message = String(((await request.json()) as { message?: unknown }).message ?? "");
  } catch {
    return Response.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  const claims = verifyMoodleMessage(message, secret);
  if (!claims) return Response.json({ ok: false, error: "bad or expired signature" }, { status: 401 });
  const installed = await prisma.session.findFirst({ where: { shop: claims.shop, isOnline: false }, select: { id: true } });
  if (!installed) return Response.json({ ok: false, error: "shop not installed" }, { status: 404 });
  try {
    const { admin } = await unauthenticated.admin(claims.shop);
    const result = await handleMoodleMessage(admin, claims);
    console.log(`moodle ${claims.type} ${claims.id} for ${claims.shop}: ${result}`);
    return Response.json({ ok: true, result });
  } catch (error) {
    console.error(`moodle ${claims.type} ${claims.id} for ${claims.shop} failed:`, error);
    return Response.json({ ok: false, error: "failed, retry later" }, { status: 500 });
  }
};

export const loader = () => new Response("Not found", { status: 404 });

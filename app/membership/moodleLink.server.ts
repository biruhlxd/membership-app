// Messages from the store's Moodle site (USSEA: local_ussea) to this app,
// POSTed to /api/moodle as {"message": "<claims>.<signature>"}: the claims are
// JSON in base64url, the signature is HMAC-SHA256 of that text with
// MOODLE_LINK_SECRET, also base64url. Every message carries "exp" (seconds
// since 1970), "shop" (the store's myshopify domain), "id" (Moodle's event id,
// so a retried message is handled once) and "type". The same format as EdTech
// Bridge's (local_shopifybridge\signature).
//
//   account_ready  {customer}  the customer's Moodle account, plan and courses
//                              are in place: their waiting welcome goes out
//   seat_assigned  {email, first_name, organization, seat_type}
//                              an organization gave someone a seat: the
//                              sub-account welcome goes out
import { createHmac, timingSafeEqual } from "node:crypto";
import prisma from "../db.server";
import type { Admin } from "./plans.server";
import { sendSeatWelcome, welcomeReady } from "./emails.server";

/** Longest lifetime accepted, in seconds; a message claiming more is refused. */
export const MAX_SECONDS = 300;
/** Secrets shorter than this are refused. */
export const MIN_SECRET_LENGTH = 32;

export type MoodleClaims = {
  exp: number;
  shop: string;
  id: string;
  type: string;
  [key: string]: unknown;
};

function sign(body: string, secret: string) {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

/** Sign claims (tests, and the Moodle side's reference). */
export function signMoodleMessage(claims: Omit<MoodleClaims, "exp">, secret: string, seconds = 60, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...claims, exp: Math.floor(now / 1000) + seconds })).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** The claims of a correctly signed, unexpired message; null otherwise. */
export function verifyMoodleMessage(token: string, secret: string, now = Date.now()): MoodleClaims | null {
  if (secret.length < MIN_SECRET_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = Buffer.from(sign(parts[0], secret));
  const given = Buffer.from(parts[1]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const c = claims as Partial<MoodleClaims> | null;
  if (!c || !Number.isInteger(c.exp) || typeof c.shop !== "string" || typeof c.id !== "string" || typeof c.type !== "string") {
    return null;
  }
  const seconds = Math.floor(now / 1000);
  if (c.exp! < seconds || c.exp! > seconds + MAX_SECONDS) return null;
  return c as MoodleClaims;
}

const text = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Act on one message, once per Moodle event id. Returns what happened, for
 * Moodle's log; an unknown type is recorded and ignored, so a newer Moodle
 * doesn't retry forever.
 */
export async function handleMoodleMessage(admin: Admin, claims: MoodleClaims, now = new Date()): Promise<string> {
  const { shop, id, type } = claims;
  const seen = await prisma.moodleEvent.findUnique({ where: { shop_eventId: { shop, eventId: id } } });
  if (seen) return "already handled";
  let result: string;
  switch (type) {
    case "account_ready": {
      const customer = text(claims.customer);
      if (!/^gid:\/\/shopify\/Customer\/\d+$/.test(customer)) return "bad customer";
      result = `${await welcomeReady(admin, shop, customer, now)} welcome sent`;
      break;
    }
    case "seat_assigned": {
      const sent = await sendSeatWelcome(admin, shop, {
        email: text(claims.email, 254).toLowerCase(),
        firstName: text(claims.first_name, 100),
        organizationName: text(claims.organization),
        seatType: text(claims.seat_type, 50),
      });
      result = sent ? "sub-account welcome sent" : "sub-account welcome not sent";
      break;
    }
    default:
      result = "unknown type, ignored";
  }
  // After acting: a failure above makes Moodle retry, and the retry acts.
  await prisma.moodleEvent.create({ data: { shop, eventId: id, type } });
  return result;
}

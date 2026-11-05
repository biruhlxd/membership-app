// Personal data at rest: email addresses and names are encrypted before they
// are saved (AES-256-GCM with DATA_KEY, 64 hex characters, kept only in the
// server's app settings), and seat emails are found by a keyed hash
// (HMAC-SHA256) instead of the address itself. Every read of personal data is
// recorded in the access log. See docs/SECURITY.md.
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import prisma from "../db.server";

function dataKey(): Buffer {
  if (!process.env.DATA_KEY && process.env.NODE_ENV !== "production") {
    try {
      process.loadEnvFile();
    } catch {
      // No .env: the check below says what is missing.
    }
  }
  const hex = process.env.DATA_KEY ?? "";
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error("DATA_KEY must be set to 64 hex characters.");
  return Buffer.from(hex, "hex");
}

/** Encrypt a personal field for storage: "v1.<iv>.<tag>.<data>"; "" stays "". */
export function sealField(value: string): string {
  if (!value) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dataKey(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

/** Whether a stored value is already encrypted. */
export function isSealed(stored: string | null | undefined): boolean {
  return Boolean(stored?.startsWith("v1."));
}

/** Read a stored personal field; values saved before encryption are returned as they are. */
export function openField(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!isSealed(stored)) return stored;
  const [, iv, tag, data] = stored.split(".");
  const decipher = createDecipheriv("aes-256-gcm", dataKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** Keyed hash of a (normalized) email address, for finding it without storing it in plain text. */
export function emailHash(email: string): string {
  return createHmac("sha256", dataKey()).update(email.trim().toLowerCase()).digest("hex");
}

/**
 * Record a read of customer personal data. actor: "staff:<user id>",
 * "system:<job>" or "shopify:<webhook>"; subject: what was read.
 */
export async function logAccess(shop: string, actor: string, action: string, subject: string): Promise<void> {
  try {
    await prisma.accessLog.create({ data: { shop, actor, action, subject } });
  } catch (error) {
    console.error("access log write failed", error);
  }
}

/** Access log rows are kept for 12 months. */
export async function pruneAccessLog(now = new Date()): Promise<number> {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  return (await prisma.accessLog.deleteMany({ where: { at: { lt: cutoff } } })).count;
}

/**
 * Encrypt rows saved before encryption (seats, sent-email records, credential
 * holder names). Safe to run any number of times; run by the renewals job.
 */
export async function sealLegacyData(): Promise<number> {
  let changed = 0;
  for (const seat of await prisma.seat.findMany({ where: { emailHash: null }, select: { id: true, email: true } })) {
    const email = openField(seat.email);
    await prisma.seat.update({ where: { id: seat.id }, data: { email: sealField(email), emailHash: emailHash(email) } });
    changed++;
  }
  for (const log of await prisma.emailLog.findMany({ where: { NOT: { to: { startsWith: "v1." } } }, select: { id: true, to: true } })) {
    await prisma.emailLog.update({ where: { id: log.id }, data: { to: sealField(log.to) } });
    changed++;
  }
  for (const c of await prisma.credential.findMany({ where: { NOT: { holderName: { startsWith: "v1." } } }, select: { id: true, holderName: true } })) {
    await prisma.credential.update({ where: { id: c.id }, data: { holderName: sealField(c.holderName) } });
    changed++;
  }
  return changed;
}

// Credentials: earning, approving, issuing, expiring, and the renewal check.
// Rules are in credentials.ts; this module reads and writes the database and
// the customer's tags in Shopify.
import { randomBytes } from "node:crypto";
import prisma from "../db.server";
import type { Admin } from "./plans.server";
import { grantsAccess, type MembershipStatus } from "./status";
import { sealField } from "./dataCrypto.server";
import {
  credentialNumber,
  credentialTag,
  expiresAt,
  publicName,
  renewalDecision,
  requirementsFromJson,
  requirementsMet,
  type RenewalRule,
} from "./credentials";

const CUSTOMER = `#graphql
  query credentialCustomer($id: ID!) {
    customer(id: $id) {
      tags
      firstName
      lastName
    }
  }`;

const TAGS_ADD = `#graphql
  mutation credentialTagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      userErrors { field message }
    }
  }`;

const TAGS_REMOVE = `#graphql
  mutation credentialTagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      userErrors { field message }
    }
  }`;

interface CustomerFacts {
  tags: string[];
  firstName: string | null;
  lastName: string | null;
}

async function customerFacts(admin: Admin, customerId: string): Promise<CustomerFacts | null> {
  const json = (await (await admin.graphql(CUSTOMER, { variables: { id: customerId } })).json()) as {
    data?: { customer?: CustomerFacts | null };
  };
  return json.data?.customer ?? null;
}

/** Plans the customer has access through right now. */
async function activePlanIds(shop: string, customerId: string): Promise<string[]> {
  const memberships = await prisma.membership.findMany({ where: { shop, customerId }, select: { planId: true, status: true } });
  return memberships.filter((m) => grantsAccess(m.status as MembershipStatus)).map((m) => m.planId);
}

/**
 * Check every credential type for one customer and start the ones they now
 * qualify for: PENDING when the type needs approval, otherwise issued at
 * once. A credential already pending or active is left alone; one that
 * expired, was rejected or revoked can be earned again.
 */
export async function evaluateCustomer(admin: Admin, shop: string, customerId: string, known?: CustomerFacts) {
  const types = await prisma.credentialType.findMany({ where: { shop } });
  if (!types.length) return [];
  const facts = known ?? (await customerFacts(admin, customerId));
  if (!facts) return [];
  const planIds = await activePlanIds(shop, customerId);
  const started: string[] = [];
  for (const type of types) {
    if (!requirementsMet(requirementsFromJson(type.requirements), { tags: facts.tags, planIds })) continue;
    const current = await prisma.credential.findFirst({
      where: { shop, typeId: type.id, customerId, status: { in: ["PENDING", "ACTIVE"] } },
    });
    if (current) continue;
    const credential = await prisma.credential.create({
      data: {
        shop,
        typeId: type.id,
        customerId,
        holderName: sealField(publicName(facts.firstName, facts.lastName)),
        status: "PENDING",
        verifyCode: randomBytes(12).toString("base64url"),
      },
    });
    if (!type.needsApproval) await issue(admin, shop, credential.id);
    started.push(type.code);
  }
  return started;
}

/** Give a pending credential its number and dates, and tag the customer. */
export async function issue(admin: Admin, shop: string, credentialId: string, now = new Date()) {
  const issued = await prisma.$transaction(async (tx) => {
    const credential = await tx.credential.findFirst({ where: { id: credentialId, shop, status: "PENDING" } });
    if (!credential) return null;
    // Incrementing first makes the sequence number unique even for two approvals at once.
    const type = await tx.credentialType.update({
      where: { id: credential.typeId },
      data: { nextSequence: { increment: 1 } },
    });
    return tx.credential.update({
      where: { id: credential.id },
      data: {
        status: "ACTIVE",
        number: credentialNumber(type.code, now.getUTCFullYear(), type.nextSequence - 1),
        issuedAt: now,
        expiresAt: expiresAt(now, type.validityMonths),
      },
      include: { type: true },
    });
  });
  if (issued) await setTag(admin, issued.customerId, credentialTag(issued.type.code), true);
  return issued;
}

export async function reject(shop: string, credentialId: string, note: string) {
  await prisma.credential.updateMany({
    where: { id: credentialId, shop, status: "PENDING" },
    data: { status: "REJECTED", note: note.slice(0, 500) || null },
  });
}

/** Take back an active credential (issued by mistake, or misconduct). */
export async function revoke(admin: Admin, shop: string, credentialId: string, note: string) {
  const credential = await prisma.credential.findFirst({ where: { id: credentialId, shop, status: "ACTIVE" }, include: { type: true } });
  if (!credential) return;
  await prisma.credential.update({ where: { id: credential.id }, data: { status: "REVOKED", note: note.slice(0, 500) || null } });
  await dropTagIfNoneLeft(admin, shop, credential.customerId, credential.typeId, credential.type.code);
}

/** Mark credentials whose date has passed as EXPIRED and remove their tags. */
export async function expireDue(admin: Admin, shop: string, now = new Date()) {
  const due = await prisma.credential.findMany({
    where: { shop, status: "ACTIVE", expiresAt: { lte: now } },
    include: { type: true },
  });
  for (const credential of due) {
    await prisma.credential.update({ where: { id: credential.id }, data: { status: "EXPIRED" } });
    await dropTagIfNoneLeft(admin, shop, credential.customerId, credential.typeId, credential.type.code);
  }
  return due.length;
}

async function dropTagIfNoneLeft(admin: Admin, shop: string, customerId: string, typeId: string, code: string) {
  const stillActive = await prisma.credential.count({ where: { shop, customerId, typeId, status: "ACTIVE" } });
  if (!stillActive) await setTag(admin, customerId, credentialTag(code), false);
}

async function setTag(admin: Admin, customerId: string, tag: string, add: boolean) {
  const response = await admin.graphql(add ? TAGS_ADD : TAGS_REMOVE, { variables: { id: customerId, tags: [tag] } });
  const json = (await response.json()) as {
    data?: Record<string, { userErrors?: { message: string }[] } | undefined>;
  };
  const errors = Object.values(json.data ?? {})[0]?.userErrors ?? [];
  if (errors.length) console.error(`credential tag ${tag} on ${customerId}:`, errors);
}

/**
 * Before a renewal is charged: the credential types that check this plan.
 * "block" means don't charge until the member holds an active credential
 * again; "flag" means charge but show the issue on the Members page.
 */
export async function renewalCheck(
  shop: string,
  customerId: string,
  planId: string,
): Promise<{ decision: "charge" | "flag" | "block"; issue: string | null }> {
  const types = await prisma.credentialType.findMany({ where: { shop, renewalRule: { not: "none" } } });
  const checking = types.filter((type) => (JSON.parse(type.renewalPlanIds) as string[]).includes(planId));
  let decision: "charge" | "flag" | "block" = "charge";
  const lapsed: string[] = [];
  for (const type of checking) {
    const active = await prisma.credential.count({ where: { shop, customerId, typeId: type.id, status: "ACTIVE" } });
    const result = renewalDecision(type.renewalRule as RenewalRule, active > 0);
    if (result === "charge") continue;
    lapsed.push(type.name);
    if (result === "block" || decision === "charge") decision = result;
  }
  return { decision, issue: lapsed.length ? `${lapsed.join(", ")} not active` : null };
}

/** Credentials of a customer, for the privacy data request. */
export function customerCredentials(shop: string, customerId: string) {
  return prisma.credential.findMany({ where: { shop, customerId }, include: { type: { select: { name: true } } } });
}

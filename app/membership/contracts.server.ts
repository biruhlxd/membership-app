// Keeping memberships in step with Shopify's subscription contracts.
//
// A contract webhook only says "this contract changed". The app reads the
// contract from Shopify each time and acts on what Shopify says now, so
// webhooks that arrive twice or out of order still end in the right state.
//
// All operations are validated against the 2026-10 Admin API schema.
import prisma from "../db.server";
import type { Admin } from "./plans.server";
import {
  accessEndsAt,
  desiredTags,
  membershipStatus,
  tagChanges,
  type ContractStatus,
  type MembershipStatus,
} from "./status";

const CONTRACT = `#graphql
  query membershipContract($id: ID!) {
    subscriptionContract(id: $id) {
      id
      status
      customer {
        id
        tags
      }
      lines(first: 10) {
        nodes {
          sellingPlanId
        }
      }
    }
  }`;

const TAGS_ADD = `#graphql
  mutation membershipTagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      userErrors {
        field
        message
      }
    }
  }`;

const TAGS_REMOVE = `#graphql
  mutation membershipTagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      userErrors {
        field
        message
      }
    }
  }`;

type Contract = {
  id: string;
  status: ContractStatus;
  customer: { id: string; tags: string[] } | null;
  lines: { nodes: { sellingPlanId: string | null }[] };
};

export type SyncResult =
  | { synced: true; status: MembershipStatus; tags: { add: string[]; remove: string[] } }
  | { synced: false; reason: string };

async function gql<T>(
  admin: Admin,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const body = await (await admin.graphql(query, { variables })).json();
  return body.data as T;
}

/**
 * Bring one contract's membership up to date: create or update the
 * Membership row, then correct the customer's plan tags.
 */
export async function syncContract(
  admin: Admin,
  shop: string,
  contractId: string,
): Promise<SyncResult> {
  const { subscriptionContract: contract } = await gql<{
    subscriptionContract: Contract | null;
  }>(admin, CONTRACT, { id: contractId });
  if (!contract) return { synced: false, reason: "contract not found" };
  if (!contract.customer) return { synced: false, reason: "contract has no customer" };

  // The plan is the one whose selling plan is on the contract's lines.
  const sellingPlanIds = contract.lines.nodes
    .map((line) => line.sellingPlanId)
    .filter((id): id is string => Boolean(id));
  const plan = await prisma.membershipPlan.findFirst({
    where: { shop, sellingPlanId: { in: sellingPlanIds } },
  });
  if (!plan) return { synced: false, reason: "not a membership plan of this app" };

  const existing = await prisma.membership.findUnique({
    where: { shop_contractId: { shop, contractId: contract.id } },
  });
  // On cancellation, remember once how long the paid period lasts: the
  // renewal that would have come next. Read before refreshSchedule clears
  // the next renewal for a contract that is no longer active.
  const now = new Date();
  const endsAt =
    contract.status === "CANCELLED"
      ? existing?.accessEndsAt ?? accessEndsAt(existing?.nextRenewalAt ?? null, now)
      : null;

  const status = membershipStatus({
    contractStatus: contract.status,
    failedAttempts: existing?.failedAttempts ?? 0,
    // When retries run out, the renewal job marks the contract FAILED in
    // Shopify, so the contract status already says the membership lapsed.
    dunningExhausted: false,
    accessEndsAt: endsAt,
    now,
  });

  await prisma.membership.upsert({
    where: { shop_contractId: { shop, contractId: contract.id } },
    create: {
      shop,
      contractId: contract.id,
      customerId: contract.customer.id,
      planId: plan.id,
      contractStatus: contract.status,
      status,
      accessEndsAt: endsAt,
    },
    update: {
      customerId: contract.customer.id,
      planId: plan.id,
      contractStatus: contract.status,
      status,
      accessEndsAt: endsAt,
    },
  });

  const tags = await syncCustomerTags(admin, shop, contract.customer);
  return { synced: true, status, tags };
}

/**
 * Give a customer the tag of every plan they hold access through, and take
 * away the app's other plan tags. The merchant's own tags are never touched.
 */
async function syncCustomerTags(
  admin: Admin,
  shop: string,
  customer: { id: string; tags: string[] },
) {
  const [memberships, plans] = await Promise.all([
    prisma.membership.findMany({
      where: { shop, customerId: customer.id },
      select: { status: true, plan: { select: { tag: true } } },
    }),
    prisma.membershipPlan.findMany({ where: { shop }, select: { tag: true } }),
  ]);
  const wanted = desiredTags(
    memberships.map((m) => ({
      status: m.status as MembershipStatus,
      tag: m.plan.tag,
    })),
  );
  const changes = tagChanges(
    customer.tags,
    plans.map((p) => p.tag),
    wanted,
  );

  if (changes.add.length > 0) {
    await gql(admin, TAGS_ADD, { id: customer.id, tags: changes.add });
  }
  if (changes.remove.length > 0) {
    await gql(admin, TAGS_REMOVE, { id: customer.id, tags: changes.remove });
  }
  return changes;
}

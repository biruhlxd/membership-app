// Keeping memberships in step with Shopify's subscription contracts.
//
// A contract webhook only says "this contract changed". The app reads the
// contract from Shopify each time and acts on what Shopify says now, so
// webhooks that arrive twice or out of order still end in the right state.
//
// All operations are validated against the 2026-10 Admin API schema.
import prisma from "../db.server";
import { managedTags, seatTypesFromJson } from "./organizations";
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

  // An import the app took back (import.server.ts) leaves the customer's tags
  // alone: they still come from the other app's subscription.
  const takenBack = await prisma.contractImport.findFirst({
    where: { shop, contractId: contract.id, status: "FAILED" },
    select: { id: true },
  });
  if (takenBack) return { synced: true, status, tags: { add: [], remove: [] } };
  const tags = await syncCustomerTags(admin, shop, contract.customer);

  // An organization plan: make sure the buyer has their organization, and
  // bring every seat holder's tags in line with the organization's status
  // (seats pause when it lapses and come back when it renews).
  if (seatTypesFromJson(plan.seatTypes).length > 0) {
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { shop_contractId: { shop, contractId: contract.id } },
      select: { id: true },
    });
    const organization = await prisma.organization.upsert({
      where: { membershipId: membership.id },
      create: { shop, membershipId: membership.id, adminCustomerId: contract.customer.id },
      update: {},
    });
    const holders = await prisma.seat.findMany({
      where: { organizationId: organization.id, status: "ACTIVE", customerId: { not: null } },
      select: { customerId: true },
    });
    for (const customerId of new Set(holders.map((h) => h.customerId!))) {
      await syncTagsForCustomer(admin, shop, customerId);
    }
  }
  return { synced: true, status, tags };
}

/**
 * Give a customer the tag of every plan they hold access through, and take
 * away the app's other plan tags. The merchant's own tags are never touched.
 */
const CUSTOMER_TAGS = `#graphql
  query membershipCustomerTags($id: ID!) {
    customer(id: $id) {
      id
      tags
    }
  }`;

/**
 * Bring one customer's plan and seat tags in line, by customer id: for seat
 * holders, who have no contract of their own.
 */
export async function syncTagsForCustomer(admin: Admin, shop: string, customerId: string) {
  const { customer } = await gql<{ customer: { id: string; tags: string[] } | null }>(
    admin,
    CUSTOMER_TAGS,
    { id: customerId },
  );
  if (!customer) return null;
  return syncCustomerTags(admin, shop, customer);
}

async function syncCustomerTags(
  admin: Admin,
  shop: string,
  customer: { id: string; tags: string[] },
) {
  const [memberships, seats, plans] = await Promise.all([
    prisma.membership.findMany({
      where: { shop, customerId: customer.id },
      select: { status: true, plan: { select: { tag: true } } },
    }),
    // Seats held in organizations: the seat's tag, while the organization's
    // own membership grants access.
    prisma.seat.findMany({
      where: { customerId: customer.id, status: "ACTIVE", organization: { shop } },
      select: { tag: true, organization: { select: { membershipId: true } } },
    }),
    prisma.membershipPlan.findMany({ where: { shop }, select: { tag: true, seatTypes: true } }),
  ]);
  const orgStatus = new Map(
    (
      await prisma.membership.findMany({
        where: { id: { in: seats.map((s) => s.organization.membershipId) } },
        select: { id: true, status: true },
      })
    ).map((m) => [m.id, m.status as MembershipStatus]),
  );
  const wanted = desiredTags([
    ...memberships.map((m) => ({
      status: m.status as MembershipStatus,
      tag: m.plan.tag,
    })),
    ...seats.map((s) => ({
      status: orgStatus.get(s.organization.membershipId) ?? ("CANCELLED" as MembershipStatus),
      tag: s.tag,
    })),
  ]);
  const changes = tagChanges(customer.tags, managedTags(plans), wanted);

  if (changes.add.length > 0) {
    await gql(admin, TAGS_ADD, { id: customer.id, tags: changes.add });
  }
  if (changes.remove.length > 0) {
    await gql(admin, TAGS_REMOVE, { id: customer.id, tags: changes.remove });
  }
  return changes;
}

const REFUNDED_ORDER = `#graphql
  query membershipRefundedOrder($id: ID!) {
    order(id: $id) {
      id
      displayFinancialStatus
      customer {
        id
      }
      lineItems(first: 20) {
        nodes {
          sellingPlan {
            sellingPlanId
          }
        }
      }
    }
  }`;

const CANCEL_CONTRACT = `#graphql
  mutation membershipContractCancel($id: ID!) {
    subscriptionContractCancel(subscriptionContractId: $id) {
      contract {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }`;

/**
 * A fully refunded order (refunds/create) ends the memberships it paid for
 * at once (Biruh's rule for USSEA, 2026-11-16): the contract is cancelled, no
 * access is kept to the end of the period, and the plan tag goes. A partial
 * refund changes nothing. Returns the ids of the memberships ended.
 */
export async function endOnRefund(admin: Admin, shop: string, orderId: string, now = new Date()): Promise<string[]> {
  const { order } = await gql<{
    order: {
      displayFinancialStatus: string | null;
      customer: { id: string } | null;
      lineItems: { nodes: { sellingPlan: { sellingPlanId: string | null } | null }[] };
    } | null;
  }>(admin, REFUNDED_ORDER, { id: orderId });
  if (!order?.customer || order.displayFinancialStatus !== "REFUNDED") return [];
  const sellingPlanIds = order.lineItems.nodes
    .map((l) => l.sellingPlan?.sellingPlanId)
    .filter((id): id is string => Boolean(id));
  if (sellingPlanIds.length === 0) return [];
  const memberships = await prisma.membership.findMany({
    where: {
      shop,
      customerId: order.customer.id,
      plan: { sellingPlanId: { in: sellingPlanIds } },
      status: { not: "CANCELLED" },
    },
    select: { id: true, contractId: true, contractStatus: true },
  });
  for (const m of memberships) {
    if (m.contractStatus !== "CANCELLED" && m.contractStatus !== "EXPIRED") {
      const { subscriptionContractCancel: result } = await gql<{
        subscriptionContractCancel: { userErrors: { message: string }[] } | null;
      }>(admin, CANCEL_CONTRACT, { id: m.contractId });
      if (result?.userErrors.length) {
        console.warn(`refund: contract ${m.contractId} not cancelled: ${result.userErrors.map((e) => e.message).join(" ")}`);
      }
    }
    // accessEndsAt = now: the cancel webhook that follows keeps it (syncContract).
    await prisma.membership.update({
      where: { id: m.id },
      data: { contractStatus: "CANCELLED", status: "CANCELLED", accessEndsAt: now, welcomeDueAt: null },
    });
  }
  if (memberships.length > 0) await syncTagsForCustomer(admin, shop, order.customer.id);
  return memberships.map((m) => m.id);
}

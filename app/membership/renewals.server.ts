// Charging renewals and recording the results.
//
// Order of operations for every charge:
//   1. save a PENDING BillingAttempt with its idempotency key (unique), then
//   2. ask Shopify to charge that cycle with the same key.
// A crash between the two leaves a PENDING row; later runs wait for it (up to
// a day), and Shopify's idempotency key stops a repeat charge.
// Results arrive by webhook (recordAttemptResult).
//
// All operations are validated against the 2026-10 Admin API schema.
import prisma from "../db.server";
import { billingAttemptKey } from "./billing";
import { syncContract } from "./contracts.server";
import { notifyLapsed, notifyPaymentFailed, sendDueReminders } from "./emails.server";
import { DEFAULT_DUNNING } from "./dunning";
import type { Admin } from "./plans.server";
import {
  dueCycle,
  linePriceChanges,
  nextUnbilledCycle,
  renewalAmount,
  normalizeErrorCode,
  onChargeFailed,
  type BillingCycle,
  type ContractLine,
} from "./renewals";

const DUE_CYCLES = `#graphql
  query membershipDueCycles($contractId: ID!, $startIndex: Int!, $endIndex: Int!) {
    subscriptionBillingCycles(
      first: 10
      contractId: $contractId
      billingCyclesIndexRangeSelector: { startIndex: $startIndex, endIndex: $endIndex }
    ) {
      nodes {
        cycleIndex
        cycleStartAt
        billingAttemptExpectedDate
        status
        skipped
      }
    }
  }`;

const CHARGE = `#graphql
  mutation membershipBillingAttempt(
    $contractId: ID!
    $input: SubscriptionBillingAttemptInput!
  ) {
    subscriptionBillingAttemptCreate(
      subscriptionContractId: $contractId
      subscriptionBillingAttemptInput: $input
    ) {
      subscriptionBillingAttempt {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }`;

const FAIL_CONTRACT = `#graphql
  mutation membershipContractFail($id: ID!) {
    subscriptionContractFail(subscriptionContractId: $id) {
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

const CONTRACT_LINES = `#graphql
  query membershipContractLines($id: ID!) {
    subscriptionContract(id: $id) {
      lines(first: 10) {
        nodes {
          id
          quantity
          currentPrice {
            amount
            currencyCode
          }
          pricingPolicy {
            basePrice {
              amount
            }
            cycleDiscounts {
              afterCycle
              computedPrice {
                amount
              }
            }
          }
        }
      }
    }
  }`;

const CONTRACT_DRAFT = `#graphql
  mutation membershipContractDraft($contractId: ID!) {
    subscriptionContractUpdate(contractId: $contractId) {
      draft {
        id
      }
      userErrors {
        field
        message
      }
    }
  }`;

const DRAFT_LINE_PRICE = `#graphql
  mutation membershipDraftLinePrice(
    $draftId: ID!
    $lineId: ID!
    $input: SubscriptionLineUpdateInput!
  ) {
    subscriptionDraftLineUpdate(draftId: $draftId, lineId: $lineId, input: $input) {
      draft {
        id
      }
      userErrors {
        field
        message
      }
    }
  }`;

const DRAFT_COMMIT = `#graphql
  mutation membershipDraftCommit($draftId: ID!) {
    subscriptionDraftCommit(draftId: $draftId) {
      contract {
        id
      }
      userErrors {
        field
        message
      }
    }
  }`;

type UserErrors = { userErrors: { message: string }[] };

function check(result: UserErrors | null | undefined, step: string) {
  if (!result) throw new Error(`${step}: no response from Shopify`);
  if (result.userErrors.length > 0) {
    throw new Error(`${step}: ${result.userErrors.map((e) => e.message).join(" ")}`);
  }
}

/**
 * Set the contract's line prices to what cycle `cycleIndex` owes. Shopify
 * keeps charging the line's currentPrice until the app changes it; the
 * pricing policy is only the intent. Returns the lines changed.
 */
async function alignPrices(admin: Admin, contractId: string, cycleIndex: number) {
  const { subscriptionContract } = await gql<{
    subscriptionContract: { lines: { nodes: ContractLine[] } } | null;
  }>(admin, CONTRACT_LINES, { id: contractId });
  const changes = linePriceChanges(subscriptionContract?.lines.nodes ?? [], cycleIndex);
  if (changes.length === 0) return changes;

  const { subscriptionContractUpdate: draft } = await gql<{
    subscriptionContractUpdate: UserErrors & { draft: { id: string } | null };
  }>(admin, CONTRACT_DRAFT, { contractId });
  check(draft, "open contract draft");
  const draftId = draft.draft!.id;

  for (const change of changes) {
    const { subscriptionDraftLineUpdate: line } = await gql<{
      subscriptionDraftLineUpdate: UserErrors;
    }>(admin, DRAFT_LINE_PRICE, {
      draftId,
      lineId: change.lineId,
      input: { currentPrice: change.price },
    });
    check(line, "set line price");
  }
  const { subscriptionDraftCommit: commit } = await gql<{
    subscriptionDraftCommit: UserErrors;
  }>(admin, DRAFT_COMMIT, { draftId });
  check(commit, "commit contract draft");
  return changes;
}

// How many cycles to read after the last paid one. Shopify refuses ranges
// that reach too far ahead ("Upcoming billing cycle selected past limit": on
// a yearly plan cycles 3-12 failed, 1-5 worked), so keep it small. Missed
// cycles are charged oldest first; any beyond the window come next run.
const CYCLES_AHEAD = 3;

async function gql<T>(
  admin: Admin,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const body = await (await admin.graphql(query, { variables })).json();
  return body.data as T;
}

/**
 * The contract's cycles after the last one this app was paid for. Searched
 * by cycle number, not date: Shopify refuses a date range that starts before
 * the contract existed. Shopify's status on each cycle stays the authority.
 */
async function upcomingCycles(admin: Admin, membershipId: string, contractId: string) {
  const lastPaid = await prisma.billingAttempt.findFirst({
    where: { membershipId, state: "SUCCEEDED" },
    orderBy: { cycleIndex: "desc" },
    select: { cycleIndex: true },
  });
  const startIndex = (lastPaid?.cycleIndex ?? 0) + 1;
  const { subscriptionBillingCycles } = await gql<{
    subscriptionBillingCycles: { nodes: BillingCycle[] };
  }>(admin, DUE_CYCLES, {
    contractId,
    startIndex,
    endIndex: startIndex + CYCLES_AHEAD - 1,
  });
  return subscriptionBillingCycles?.nodes ?? [];
}

/**
 * Store the membership's next renewal date and amount, read from Shopify, for
 * the Members page. Called after every change: purchase, contract update,
 * renewal result.
 */
export async function refreshSchedule(admin: Admin, membershipId: string) {
  const m = await prisma.membership.findUnique({ where: { id: membershipId } });
  if (!m) return;
  if (m.contractStatus !== "ACTIVE") {
    await prisma.membership.update({
      where: { id: m.id },
      data: { nextRenewalAt: null, nextRenewalAmount: null },
    });
    return;
  }
  const cycles = await upcomingCycles(admin, m.id, m.contractId);
  const cycle = nextUnbilledCycle(cycles);
  if (!cycle) {
    console.warn(
      `membership ${m.id}: no unpaid renewal among the cycles Shopify returned:`,
      JSON.stringify(cycles),
    );
  }
  const { subscriptionContract } = await gql<{
    subscriptionContract: { lines: { nodes: ContractLine[] } } | null;
  }>(admin, CONTRACT_LINES, { id: m.contractId });
  const total = cycle
    ? renewalAmount(subscriptionContract?.lines.nodes ?? [], cycle.cycleIndex)
    : null;
  await prisma.membership.update({
    where: { id: m.id },
    data: {
      nextRenewalAt: cycle ? new Date(cycle.billingAttemptExpectedDate) : null,
      nextRenewalAmount: total?.amount ?? null,
      currency: total?.currency ?? m.currency,
    },
  });
}

export type RenewResult =
  | { charged: true; cycleIndex: number; attempt: number }
  | { charged: false; reason: string };

/** Charge one membership's due renewal, if it has one. */
export async function renewMembership(
  admin: Admin,
  membershipId: string,
  now = new Date(),
  { early = false }: { early?: boolean } = {},
): Promise<RenewResult> {
  const m = await prisma.membership.findUnique({ where: { id: membershipId } });
  if (!m) return { charged: false, reason: "membership not found" };
  if (m.contractStatus !== "ACTIVE") return { charged: false, reason: "contract not active" };
  if (m.status !== "ACTIVE" && m.status !== "PAST_DUE") {
    return { charged: false, reason: `membership is ${m.status.toLowerCase()}` };
  }
  if (m.nextAttemptAt && m.nextAttemptAt > now) {
    return { charged: false, reason: "waiting for the next retry" };
  }
  // A result webhook that never came would block the membership forever.
  // After a day the attempt is marked UNKNOWN; charging again is safe because
  // a cycle that was in fact paid is BILLED and dueCycle skips it.
  const stale = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  await prisma.billingAttempt.updateMany({
    where: { membershipId: m.id, state: "PENDING", createdAt: { lt: stale } },
    data: { state: "UNKNOWN" },
  });
  const pending = await prisma.billingAttempt.count({
    where: { membershipId: m.id, state: "PENDING" },
  });
  if (pending > 0) return { charged: false, reason: "a charge is still in progress" };

  // Normally only a cycle whose date has come. Early (Renew now): the next
  // unpaid cycle, whatever its date; Shopify bills a future cycle directly.
  const cycles = await upcomingCycles(admin, m.id, m.contractId);
  const cycle = early ? nextUnbilledCycle(cycles) : dueCycle(cycles, now);
  if (!cycle) {
    return { charged: false, reason: early ? "no unpaid renewal found" : "nothing due" };
  }

  // Never charge a price the cycle doesn't owe: if the price can't be set,
  // don't charge at all; the next run tries again.
  try {
    const changed = await alignPrices(admin, m.contractId, cycle.cycleIndex);
    if (changed.length > 0) {
      console.log(
        `membership ${m.id}: cycle ${cycle.cycleIndex} price set to ${changed.map((c) => c.price).join(", ")}`,
      );
    }
  } catch (error) {
    console.error(`membership ${m.id}: could not set the renewal price:`, error);
    return { charged: false, reason: "could not set the renewal price" };
  }

  const attempt =
    (await prisma.billingAttempt.count({
      where: { membershipId: m.id, cycleIndex: cycle.cycleIndex },
    })) + 1;
  const idempotencyKey = billingAttemptKey(m.contractId, cycle.cycleIndex, attempt);

  // Saved before Shopify is asked: the unique key makes a double charge
  // impossible even if two runs overlap.
  const row = await prisma.billingAttempt.create({
    data: {
      membershipId: m.id,
      cycleIndex: cycle.cycleIndex,
      attempt,
      idempotencyKey,
      state: "PENDING",
    },
  });
  await prisma.membership.update({
    where: { id: m.id },
    data: { currentCycleIndex: cycle.cycleIndex },
  });

  const result = (
    await gql<{
      subscriptionBillingAttemptCreate: {
        subscriptionBillingAttempt: { id: string } | null;
        userErrors: { message: string; code: string | null }[];
      };
    }>(admin, CHARGE, {
      contractId: m.contractId,
      input: {
        idempotencyKey,
        billingCycleSelector: { index: cycle.cycleIndex },
        // Billing a future cycle (Renew now): Shopify wants the origin time
        // inside that cycle. Its start is safely inside; its billing date sits
        // at the very end.
        ...(new Date(cycle.billingAttemptExpectedDate) > now && cycle.cycleStartAt
          ? { originTime: cycle.cycleStartAt }
          : {}),
      },
    })
  ).subscriptionBillingAttemptCreate;

  if (!result?.subscriptionBillingAttempt || result.userErrors.length > 0) {
    const code = result?.userErrors[0]?.code ?? null;
    // Shopify refused the request itself; no card was tried. This is not a
    // failed payment, so it doesn't start the retries or count toward a lapse.
    await prisma.billingAttempt.update({
      where: { id: row.id },
      data: { state: "REFUSED", errorCode: code },
    });
    console.error(
      `membership ${m.id}: Shopify refused the charge for cycle ${cycle.cycleIndex}:`,
      result?.userErrors,
    );
    return {
      charged: false,
      reason: `Shopify refused the charge: ${result?.userErrors.map((e) => e.message).join(" ") || "no attempt created"}`,
    };
  }

  await prisma.billingAttempt.update({
    where: { id: row.id },
    data: { shopifyAttemptId: result.subscriptionBillingAttempt.id },
  });
  return { charged: true, cycleIndex: cycle.cycleIndex, attempt };
}

/** Charge every membership in a shop that is due now. */
export async function runRenewals(admin: Admin, shop: string, now = new Date()) {
  const due = await prisma.membership.findMany({
    where: {
      shop,
      contractStatus: "ACTIVE",
      status: { in: ["ACTIVE", "PAST_DUE"] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    select: { id: true },
  });
  const results: { membershipId: string; result: RenewResult }[] = [];
  for (const { id } of due) {
    try {
      results.push({ membershipId: id, result: await renewMembership(admin, id, now) });
    } catch (error) {
      // One bad membership must not stop the others.
      console.error(`renewal for membership ${id} failed:`, error);
      results.push({ membershipId: id, result: { charged: false, reason: "error" } });
    }
  }
  // Reminders ride on the same run, so the scheduler that charges renewals
  // also sends the week-before notices.
  try {
    await sendDueReminders(admin, shop, now);
  } catch (error) {
    console.error(`renewal reminders for ${shop} failed:`, error);
  }
  return results;
}

/**
 * Charge a membership's next unpaid renewal now, before its date. For
 * testing, and for a merchant who wants to bill early. Billing dates can't
 * be moved outside their cycle, so the future cycle is billed directly.
 */
export async function renewNow(admin: Admin, membershipId: string) {
  const m = await prisma.membership.findUnique({ where: { id: membershipId } });
  if (!m) return { charged: false, reason: "membership not found" } as RenewResult;

  // A retry wait doesn't apply to a charge the merchant asked for.
  await prisma.membership.update({ where: { id: m.id }, data: { nextAttemptAt: null } });
  return renewMembership(admin, m.id, new Date(), { early: true });
}

type AttemptPayload = {
  idempotency_key?: string | null;
  admin_graphql_api_order_id?: string | null;
  error_code?: string | null;
};

/** Record a billing-attempt webhook: success, failure or challenged (3-D Secure). */
export async function recordAttemptResult(
  admin: Admin,
  shop: string,
  topic: string,
  payload: AttemptPayload,
) {
  const key = payload.idempotency_key;
  if (!key) return { recorded: false, reason: "no idempotency key" };
  const row = await prisma.billingAttempt.findUnique({
    where: { idempotencyKey: key },
    include: { membership: true },
  });
  if (!row || row.membership.shop !== shop) return { recorded: false, reason: "not our attempt" };
  // Shopify can deliver a webhook more than once; act on the first only.
  if (row.state !== "PENDING") return { recorded: false, reason: "already recorded" };

  const now = new Date();
  if (topic.toLowerCase().includes("success")) {
    await prisma.billingAttempt.update({
      where: { id: row.id },
      data: { state: "SUCCEEDED", orderId: payload.admin_graphql_api_order_id ?? null },
    });
    await prisma.membership.update({
      where: { id: row.membershipId },
      data: {
        failedAttempts: 0,
        nextAttemptAt: null,
        currentCycleIndex: null,
        lastPaidAt: now,
      },
    });
    await syncContract(admin, shop, row.membership.contractId);
    await refreshSchedule(admin, row.membershipId);
    return { recorded: true, state: "SUCCEEDED" };
  }

  const challenged = topic.toLowerCase().includes("challenged");
  const code = challenged ? "AUTHENTICATION_REQUIRED" : normalizeErrorCode(payload.error_code);
  await prisma.billingAttempt.update({
    where: { id: row.id },
    data: { state: challenged ? "ACTION_REQUIRED" : "FAILED", errorCode: code },
  });
  const outcome = await handleFailure(admin, shop, row.membershipId, code, now);
  await refreshSchedule(admin, row.membershipId);
  return { recorded: true, state: challenged ? "ACTION_REQUIRED" : "FAILED", outcome };
}

/** Count the failure, then schedule a retry or end the membership. */
async function handleFailure(
  admin: Admin,
  shop: string,
  membershipId: string,
  errorCode: string | null,
  now: Date,
) {
  const m = await prisma.membership.findUniqueOrThrow({ where: { id: membershipId } });
  const outcome = onChargeFailed(DEFAULT_DUNNING, m.failedAttempts, errorCode, now);

  await prisma.membership.update({
    where: { id: m.id },
    data: {
      failedAttempts: outcome.failedAttempts,
      nextAttemptAt: outcome.action === "retry" ? outcome.nextAttemptAt : null,
    },
  });
  // TODO(emails): also tell the merchant when the failure is theirs to fix
  // (outcome.kind "merchant": gateway, inventory, customer record).
  console.log(
    `membership ${m.id}: charge failed (${errorCode ?? "no code"}, ${outcome.kind}); ${outcome.action}`,
  );

  if (outcome.action === "lapse") {
    // Shopify becomes the record of the lapse; its contract webhook then
    // sets the membership to LAPSED and removes the tag.
    await gql(admin, FAIL_CONTRACT, { id: m.contractId });
  }
  await syncContract(admin, shop, m.contractId);

  // Emails must never break billing.
  try {
    if (outcome.action === "retry") {
      await notifyPaymentFailed(admin, m.id, outcome.failedAttempts, outcome.nextAttemptAt);
    } else {
      await notifyLapsed(admin, m.id);
    }
  } catch (error) {
    console.error(`membership ${m.id}: failure email not sent:`, error);
  }
  return outcome;
}

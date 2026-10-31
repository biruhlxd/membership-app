// Which renewal to charge, and what happens after a charge fails.
// Pure functions: no Shopify calls, no database.
//
// Shopify bills at the end of each cycle: cycle 1's billingAttemptExpectedDate
// is the first renewal, cycle 2's the second, and so on. The checkout order is
// not a billing cycle.

import { priceForOrder } from "./billing";
import { afterFailure, classifyFailure, type DunningPolicy, type FailureKind } from "./dunning";

export interface BillingCycle {
  cycleIndex: number;
  billingAttemptExpectedDate: string;
  cycleStartAt?: string;
  status: string; // BILLED or UNBILLED
  skipped: boolean;
}

/** The earliest unbilled, unskipped cycle whose billing date has come. */
export function dueCycle(cycles: BillingCycle[], now: Date): BillingCycle | null {
  const due = cycles
    .filter(
      (c) =>
        c.status === "UNBILLED" &&
        !c.skipped &&
        new Date(c.billingAttemptExpectedDate).getTime() <= now.getTime(),
    )
    .sort((a, b) => a.cycleIndex - b.cycleIndex);
  return due[0] ?? null;
}

/** Webhooks may send error codes in lower case; the API enum is upper case. */
export function normalizeErrorCode(code: string | null | undefined): string | null {
  return code ? code.trim().toUpperCase() : null;
}

export type FailureOutcome =
  | { action: "retry"; failedAttempts: number; nextAttemptAt: Date; kind: FailureKind }
  | { action: "lapse"; failedAttempts: number; kind: FailureKind };

/**
 * What to do after a charge for the current cycle fails. `failedBefore` is
 * how many attempts for this cycle had already failed.
 */
export function onChargeFailed(
  policy: DunningPolicy,
  failedBefore: number,
  errorCode: string | null | undefined,
  failedAt: Date,
): FailureOutcome {
  const failedAttempts = failedBefore + 1;
  const kind = classifyFailure(normalizeErrorCode(errorCode));
  const step = afterFailure(policy, failedAttempts, failedAt);
  return step.action === "retry"
    ? { action: "retry", failedAttempts, nextAttemptAt: step.at, kind }
    : { action: "lapse", failedAttempts, kind };
}

/** A contract line as the Admin API returns it (only the fields read here). */
export interface ContractLine {
  id: string;
  quantity?: number;
  currentPrice: { amount: string; currencyCode?: string };
  pricingPolicy: {
    basePrice: { amount: string };
    cycleDiscounts: { afterCycle: number; computedPrice: { amount: string } }[];
  } | null;
}

const cents = (amount: string | number) => Math.round(Number(amount) * 100);

/**
 * The line prices to change before charging billing cycle `cycleIndex`.
 *
 * Shopify does not change a contract line's price on its own: the pricing
 * policy only records the intent, and the app must set currentPrice. Cycle N
 * is the order after N earlier orders (the checkout order is the first), so
 * `afterCycle: 1` (the renewal price) applies from cycle 1.
 */
export function linePriceChanges(
  lines: ContractLine[],
  cycleIndex: number,
): { lineId: string; price: string }[] {
  const changes: { lineId: string; price: string }[] = [];
  for (const line of lines) {
    if (!line.pricingPolicy) continue;
    const owed = owedPrice(line, cycleIndex);
    if (cents(owed) !== cents(line.currentPrice.amount)) {
      changes.push({ lineId: line.id, price: owed.toFixed(2) });
    }
  }
  return changes;
}

/**
 * The next cycle that still has to be paid, whatever its date: the one
 * "Renew now" brings forward. Billed and skipped cycles are passed over; a
 * refund does not make a billed cycle unbilled.
 */
export function nextUnbilledCycle(cycles: BillingCycle[]): BillingCycle | null {
  const open = cycles
    .filter((c) => c.status === "UNBILLED" && !c.skipped)
    .sort((a, b) => a.cycleIndex - b.cycleIndex);
  return open[0] ?? null;
}

function owedPrice(line: ContractLine, cycleIndex: number): number {
  if (!line.pricingPolicy) return Number(line.currentPrice.amount);
  return priceForOrder(
    Number(line.pricingPolicy.basePrice.amount),
    line.pricingPolicy.cycleDiscounts.map((d) => ({
      afterCycle: d.afterCycle,
      amount: Number(d.computedPrice.amount),
    })),
    cycleIndex,
  );
}

/** What billing cycle `cycleIndex` will charge in all: each line's owed price times its quantity. */
export function renewalAmount(
  lines: ContractLine[],
  cycleIndex: number,
): { amount: string; currency: string | null } {
  const total = lines.reduce(
    (sum, line) => sum + cents(owedPrice(line, cycleIndex)) * (line.quantity ?? 1),
    0,
  );
  return {
    amount: (total / 100).toFixed(2),
    currency: lines[0]?.currentPrice.currencyCode ?? null,
  };
}

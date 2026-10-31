// Which renewal to charge, and what happens after a charge fails.
// Pure functions: no Shopify calls, no database.
//
// Shopify bills at the end of each cycle: cycle 1's billingAttemptExpectedDate
// is the first renewal, cycle 2's the second, and so on. The checkout order is
// not a billing cycle.

import { afterFailure, classifyFailure, type DunningPolicy, type FailureKind } from "./dunning";

export interface BillingCycle {
  cycleIndex: number;
  billingAttemptExpectedDate: string;
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

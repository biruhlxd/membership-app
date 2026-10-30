// What happens after a renewal payment fails: retry, tell someone, or lapse.
// Pure functions: no Shopify calls, no database.

export interface DunningPolicy {
  /** Days after each failure to try again; one entry per retry. */
  retryAfterDays: number[];
}

/** Three retries, 1, 3 and 7 days after each failure (11 days in all). */
export const DEFAULT_DUNNING: DunningPolicy = { retryAfterDays: [1, 3, 7] };

/**
 * Who can fix a failure. A retry with a new card can still succeed, so every
 * kind follows the retry schedule; the kind only decides who is told.
 * - member: the member must update or confirm their payment method
 * - merchant: the store's setup is wrong (gateway, inventory, customer record)
 * - transient: worth retrying as is (declines, timeouts, unknown errors)
 */
export type FailureKind = "member" | "merchant" | "transient";

const MEMBER_CODES = new Set([
  "AUTHENTICATION_ERROR",
  "AUTHENTICATION_FAILED",
  "AUTHENTICATION_REQUIRED",
  "BUYER_CANCELED_PAYMENT_METHOD",
  "CARD_NUMBER_INCORRECT",
  "EXPIRED_BUYER_ACTION",
  "EXPIRED_CARD",
  "EXPIRED_PAYMENT_METHOD",
  "INCORRECT_ADDRESS",
  "INCORRECT_CVC",
  "INCORRECT_NUMBER",
  "INCORRECT_PIN",
  "INCORRECT_ZIP",
  "INVALID_BILLING_ADDRESS",
  "PAYMENT_METHOD_NOT_FOUND",
  "PAYMENT_METHOD_NOT_SPECIFIED",
]);

const MERCHANT_CODES = new Set([
  "CUSTOMER_INVALID",
  "CUSTOMER_NOT_FOUND",
  "INSUFFICIENT_INVENTORY",
  "INVENTORY_ALLOCATIONS_NOT_FOUND",
  "MERCHANT_ACCOUNT_ERROR",
  "NON_TEST_ORDER_LIMIT_REACHED",
  "PAYMENT_METHOD_INCOMPATIBLE_WITH_GATEWAY_CONFIG",
  "PAYMENT_PROVIDER_IS_NOT_ENABLED",
]);

export function classifyFailure(code: string | null | undefined): FailureKind {
  if (code && MEMBER_CODES.has(code)) return "member";
  if (code && MERCHANT_CODES.has(code)) return "merchant";
  return "transient";
}

export type NextStep =
  | { action: "retry"; attempt: number; at: Date }
  | { action: "lapse" };

/**
 * The step after a failed attempt for one billing cycle.
 * `failedAttempt` is the attempt that just failed, starting at 1 for the
 * scheduled charge; retries are attempts 2, 3 and so on.
 */
export function afterFailure(
  policy: DunningPolicy,
  failedAttempt: number,
  failedAt: Date,
): NextStep {
  if (!Number.isInteger(failedAttempt) || failedAttempt < 1) {
    throw new RangeError(`attempt must be >= 1, got ${failedAttempt}`);
  }
  const days = policy.retryAfterDays[failedAttempt - 1];
  if (days === undefined) return { action: "lapse" };
  return {
    action: "retry",
    attempt: failedAttempt + 1,
    at: new Date(failedAt.getTime() + days * 24 * 60 * 60 * 1000),
  };
}

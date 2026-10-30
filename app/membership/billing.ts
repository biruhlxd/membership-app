// Per-cycle prices and billing-attempt keys for membership contracts.
// Pure functions: no Shopify calls, no database.
//
// Billing dates are not worked out here. Shopify owns each contract's billing
// cycles (numbered from 1, each with a billingAttemptExpectedDate); the
// scheduler reads them from Shopify and bills the ones that are due.

/**
 * A price that starts after a number of cycles, as in Shopify's recurring
 * pricing policy (`afterCycle`). `afterCycle: 1` means "from the second
 * order on": the usual way to give the first payment (joining) a different
 * price from every renewal.
 */
export interface PricePolicy {
  afterCycle: number;
  amount: number;
}

/**
 * The price of the order placed after `ordersAlreadyPlaced` earlier orders
 * (0 for the checkout order), for showing members and merchants what a
 * renewal will cost. Shopify applies the same policies when it bills. The
 * policy with the highest `afterCycle` reached wins; `basePrice` applies
 * before any policy.
 */
export function priceForOrder(
  basePrice: number,
  policies: PricePolicy[],
  ordersAlreadyPlaced: number,
): number {
  let price = basePrice;
  let reached = -1;
  for (const policy of policies) {
    if (policy.afterCycle <= ordersAlreadyPlaced && policy.afterCycle > reached) {
      price = policy.amount;
      reached = policy.afterCycle;
    }
  }
  return price;
}

/**
 * Idempotency key for one billing attempt. The same contract, cycle and
 * attempt number always give the same key, so a retried request (a timeout,
 * a crashed job) can never charge a member twice for that attempt.
 */
export function billingAttemptKey(
  contractId: string,
  cycleIndex: number,
  attempt: number,
): string {
  const id = contractId.split("/").pop();
  if (!id) throw new Error(`invalid contract id: ${contractId}`);
  if (!Number.isInteger(cycleIndex) || cycleIndex < 1) {
    throw new RangeError(`cycle index must be >= 1, got ${cycleIndex}`);
  }
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError(`attempt must be >= 1, got ${attempt}`);
  }
  return `membership-${id}-cycle-${cycleIndex}-attempt-${attempt}`;
}

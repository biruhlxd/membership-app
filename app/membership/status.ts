// A member's status, whether it grants access, and the customer tags that
// follow from it. Pure functions: no Shopify calls, no database.

/** Shopify's SubscriptionContractSubscriptionStatus values. */
export type ContractStatus =
  | "ACTIVE"
  | "PAUSED"
  | "CANCELLED"
  | "EXPIRED"
  | "FAILED";

export type MembershipStatus =
  | "ACTIVE"
  | "PAST_DUE"
  | "PAUSED"
  | "LAPSED"
  | "CANCELLED";

export interface StatusInput {
  contractStatus: ContractStatus;
  /** Failed attempts for the cycle now being billed (0 when it is paid). */
  failedAttempts: number;
  /** True once dunning has run out of retries for that cycle. */
  dunningExhausted: boolean;
}

export function membershipStatus(input: StatusInput): MembershipStatus {
  switch (input.contractStatus) {
    case "CANCELLED":
      return "CANCELLED";
    case "PAUSED":
      return "PAUSED";
    case "EXPIRED":
    case "FAILED":
      return "LAPSED";
    case "ACTIVE":
      if (input.dunningExhausted) return "LAPSED";
      return input.failedAttempts > 0 ? "PAST_DUE" : "ACTIVE";
  }
}

/** Past-due members keep access while retries run; it ends when they lapse. */
export function grantsAccess(status: MembershipStatus): boolean {
  return status === "ACTIVE" || status === "PAST_DUE";
}

/**
 * Tags to add and remove so a customer carries exactly the tag of the plan
 * they hold access through, and no other plan tag.
 *
 * Only tags in `planTags` (the tags this app manages) are ever removed; a
 * merchant's own tags are left alone. Comparison ignores case, as Shopify's
 * tag search does.
 */
export function tagChanges(
  currentTags: string[],
  planTags: string[],
  desiredTag: string | null,
): { add: string[]; remove: string[] } {
  const lower = (t: string) => t.trim().toLowerCase();
  const managed = new Set(planTags.map(lower));
  const want = desiredTag ? lower(desiredTag) : null;
  if (want !== null && !managed.has(want)) {
    throw new Error(`"${desiredTag}" is not one of the plan tags`);
  }

  const remove = currentTags.filter(
    (t) => managed.has(lower(t)) && lower(t) !== want,
  );
  const has = currentTags.some((t) => lower(t) === want);
  const add = desiredTag && !has ? [desiredTag.trim()] : [];
  return { add, remove };
}

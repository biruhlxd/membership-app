// Members-only products: the settings the checkout function reads.
// Pure function: no Shopify calls, no database.

/** The tag a merchant gives a product to make it members-only. */
export const MEMBERS_ONLY_TAG = "members-only";

/**
 * The JSON the members-only function receives as its input variables: the
 * tags that make a customer a member (every plan tag of the shop). The key
 * matches the function's `$memberTags` query variable.
 */
export function membersOnlyConfig(planTags: string[]): string {
  const seen = new Set<string>();
  const memberTags: string[] = [];
  for (const tag of planTags) {
    const key = tag.trim().toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      memberTags.push(tag.trim());
    }
  }
  return JSON.stringify({ memberTags });
}

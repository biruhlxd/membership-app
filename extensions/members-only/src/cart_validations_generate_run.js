// @ts-check

/**
 * @typedef {import("../generated/api").CartValidationsGenerateRunInput} CartValidationsGenerateRunInput
 * @typedef {import("../generated/api").CartValidationsGenerateRunResult} CartValidationsGenerateRunResult
 */

/**
 * Members-only products: a product tagged "members-only" can only be bought
 * by a logged-in customer who carries one of the app's plan tags. The plan
 * tags arrive as the $memberTags variable, from the validation's metafield
 * that the app keeps up to date.
 *
 * @param {CartValidationsGenerateRunInput} input
 * @returns {CartValidationsGenerateRunResult}
 */
export function cartValidationsGenerateRun(input) {
  const isMember = input.cart.buyerIdentity?.customer?.hasAnyTag === true;

  const errors = isMember
    ? []
    : input.cart.lines
        .map((line) =>
          line.merchandise.__typename === "ProductVariant" &&
          line.merchandise.product.membersOnly
            ? line.merchandise.product.title
            : null,
        )
        .filter((title) => title !== null)
        .filter((title, i, all) => all.indexOf(title) === i)
        .map((title) => ({
          message: `${title} is for members only. Log in with your member account, or remove it from your cart.`,
          target: "$.cart",
        }));

  return { operations: [{ validationAdd: { errors } }] };
}

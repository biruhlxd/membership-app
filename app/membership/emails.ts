// Member emails: when they are due and what they say.
// Pure functions: no Shopify calls, no database, no sending.

export type EmailKind = "RENEWAL_REMINDER" | "PAYMENT_FAILED" | "LAPSED" | "SEAT_INVITE";

/** Days before a renewal that the reminder goes out. */
export const REMINDER_LEAD_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether the renewal reminder is due now: within the lead time before the
 * renewal, and the renewal hasn't happened yet.
 */
export function reminderDue(
  nextRenewalAt: Date | null,
  now: Date,
  leadDays = REMINDER_LEAD_DAYS,
): boolean {
  if (!nextRenewalAt) return false;
  const until = nextRenewalAt.getTime() - now.getTime();
  return until > 0 && until <= leadDays * DAY_MS;
}

/**
 * The key that makes an email unique for one membership, so it is sent once:
 * one reminder per renewal date, one failure notice per failed attempt, one
 * lapse notice per membership.
 */
export function emailKey(
  kind: EmailKind,
  detail: { renewalAt?: Date; failedAttempts?: number; seatId?: string } = {},
): string {
  switch (kind) {
    case "RENEWAL_REMINDER":
      return `renewal-${detail.renewalAt?.toISOString().slice(0, 10) ?? "unknown"}`;
    case "PAYMENT_FAILED":
      return `failed-${detail.failedAttempts ?? 0}`;
    case "LAPSED":
      return "lapsed";
    case "SEAT_INVITE":
      return `invite-${detail.seatId ?? "unknown"}`;
  }
}

export interface EmailContent {
  subject: string;
  text: string;
}

const greeting = (firstName: string | null) => (firstName ? `Hi ${firstName},` : "Hello,");

export function renewalReminderEmail(p: {
  shopName: string;
  firstName: string | null;
  planName: string;
  renewalDate: string;
  amount: string | null;
}): EmailContent {
  const charge = p.amount ? ` for ${p.amount}` : "";
  return {
    subject: `Your ${p.planName} renews on ${p.renewalDate}`,
    text: [
      greeting(p.firstName),
      "",
      `Your ${p.planName} with ${p.shopName} renews on ${p.renewalDate}${charge}. We'll charge the card on file; you don't need to do anything.`,
      "",
      "To update your card or cancel, go to the Membership page in your account.",
      "",
      p.shopName,
    ].join("\n"),
  };
}

export function paymentFailedEmail(p: {
  shopName: string;
  firstName: string | null;
  planName: string;
  retryDate: string | null;
}): EmailContent {
  const next = p.retryDate
    ? `We'll try again on ${p.retryDate}. You keep member access while we retry.`
    : "This was our last try.";
  return {
    subject: `Payment for your ${p.planName} didn't go through`,
    text: [
      greeting(p.firstName),
      "",
      `We couldn't charge your card for your ${p.planName} with ${p.shopName}. ${next}`,
      "",
      "To update your card, go to your account's profile page and change the payment method used for your membership.",
      "",
      p.shopName,
    ].join("\n"),
  };
}

export function lapsedEmail(p: {
  shopName: string;
  firstName: string | null;
  planName: string;
}): EmailContent {
  return {
    subject: `Your ${p.planName} has ended`,
    text: [
      greeting(p.firstName),
      "",
      `We couldn't collect payment for your ${p.planName} with ${p.shopName}, so your membership has ended and member access has stopped.`,
      "",
      "To become a member again, buy the membership in our store.",
      "",
      p.shopName,
    ].join("\n"),
  };
}

export function seatInviteEmail(p: {
  shopName: string;
  inviterName: string | null;
  seatName: string;
}): EmailContent {
  const who = p.inviterName ?? "Your organization";
  return {
    subject: `${who} invited you to a ${p.seatName} membership seat`,
    text: [
      "Hello,",
      "",
      `${who} has a membership with ${p.shopName} and invited you to one of its ${p.seatName} seats. The seat gives you member access and member prices.`,
      "",
      `To accept, log in to your account at ${p.shopName} with this email address, open the Membership page and choose Accept. If you don't have an account yet, logging in with this address creates one.`,
      "",
      p.shopName,
    ].join("\n"),
  };
}

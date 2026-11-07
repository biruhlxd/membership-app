// Member emails: when they are due and what they say.
// Pure functions: no Shopify calls, no database, no sending.

export type EmailKind = "WELCOME" | "RENEWAL_REMINDER" | "PAYMENT_FAILED" | "LAPSED" | "SEAT_INVITE";

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

export const RESEND_SLOT_MS = 5 * 60 * 1000;

/**
 * The key that makes an email unique for one membership, so it is sent once:
 * one reminder per renewal date, one failure notice per failed attempt, one
 * lapse notice per membership.
 */
export function emailKey(
  kind: EmailKind,
  detail: { renewalAt?: Date; failedAttempts?: number; seatId?: string; resendAt?: Date } = {},
): string {
  switch (kind) {
    case "WELCOME":
      // A resend by the merchant: at most one per 5-minute slot.
      return detail.resendAt
        ? `welcome-resend-${new Date(Math.floor(detail.resendAt.getTime() / RESEND_SLOT_MS) * RESEND_SLOT_MS).toISOString()}`
        : "welcome";
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

/**
 * After joining: what renews when, and where to manage it (Shopify asks
 * subscription apps to send the customer portal link after purchase).
 */
/**
 * The Membership page (extensions/member-portal) in a shop's customer
 * account. Shopify gives each full-page extension a fixed id; this one was
 * read from the live app's page on 2026-11-07 and differs for the dev app.
 */
export const MEMBERSHIP_PAGE_ID = "01a193a1-f5b7-726d-94ff-8e2fd8cb27eb";

export const membershipPageUrl = (accountUrl: string, pageId = MEMBERSHIP_PAGE_ID) =>
  `${accountUrl.replace(/\/+$/, "")}/pages/${pageId}`;

export function welcomeEmail(p: {
  shopName: string;
  firstName: string | null;
  planName: string;
  renewalDate: string | null;
  amount: string | null;
  accountUrl: string | null;
}): EmailContent {
  const renews = p.renewalDate
    ? `It renews automatically on ${p.renewalDate}${p.amount ? ` for ${p.amount}` : ""}, and we'll remind you a week before.`
    : "It renews automatically, and we'll remind you a week before.";
  const where = p.accountUrl
    ? `To see your membership, update your card or cancel, go to the Membership page in your account: ${p.accountUrl}`
    : "To see your membership, update your card or cancel, go to the Membership page in your account.";
  return {
    subject: `Welcome to your ${p.planName}`,
    text: [
      greeting(p.firstName),
      "",
      `Thank you for joining ${p.shopName}. Your ${p.planName} is active. ${renews}`,
      "",
      where,
      "",
      p.shopName,
    ].join("\n"),
  };
}

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

/** Days before a credential expires that the member is told. */
export const CREDENTIAL_EXPIRY_LEAD_DAYS = 30;

const longDay = (d: Date) =>
  d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

/** Whether the "expires soon" email is due: within the lead time, and not yet expired. */
export function credentialExpiryDue(expiresAt: Date | null, now: Date, leadDays = CREDENTIAL_EXPIRY_LEAD_DAYS): boolean {
  if (!expiresAt) return false;
  const until = expiresAt.getTime() - now.getTime();
  return until > 0 && until <= leadDays * DAY_MS;
}

export function credentialIssuedEmail(p: {
  shopName: string;
  firstName: string | null;
  typeName: string;
  number: string;
  expiresAt: Date | null;
  verifyUrl: string;
}): EmailContent {
  return {
    subject: `Your ${p.typeName} credential`,
    text: [
      greeting(p.firstName),
      "",
      `You now hold the ${p.typeName} credential from ${p.shopName}.`,
      "",
      `Number: ${p.number}`,
      p.expiresAt ? `Valid until: ${longDay(p.expiresAt)}` : "Valid with no expiry date.",
      "",
      `Anyone you share this link with can check it: ${p.verifyUrl}`,
      "",
      p.shopName,
    ].join("\n"),
  };
}

export function credentialPendingEmail(p: { shopName: string; firstName: string | null; typeName: string }): EmailContent {
  return {
    subject: `Your ${p.typeName} credential is being reviewed`,
    text: [
      greeting(p.firstName),
      "",
      `You meet the requirements for the ${p.typeName} credential from ${p.shopName}. It is being reviewed, and you'll get another email when it's issued.`,
      "",
      p.shopName,
    ].join("\n"),
  };
}

export function credentialExpiringEmail(p: {
  shopName: string;
  firstName: string | null;
  typeName: string;
  number: string;
  expiresAt: Date;
}): EmailContent {
  return {
    subject: `Your ${p.typeName} credential expires on ${longDay(p.expiresAt)}`,
    text: [
      greeting(p.firstName),
      "",
      `Your ${p.typeName} credential (${p.number}) from ${p.shopName} expires on ${longDay(p.expiresAt)}.`,
      "",
      `To keep it, contact ${p.shopName} about renewing it before then.`,
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

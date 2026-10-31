// Sending member emails: who to, once only, and through which channel.
//
// No email provider is connected yet (Biruh to choose one). Until then every
// email is written to the server log and recorded in EmailLog as LOGGED, so
// the timing and content can be checked. Connecting a provider means
// replacing `deliver` and nothing else.
//
// The query is validated against the 2026-10 Admin API schema.
import prisma from "../db.server";
import {
  emailKey,
  lapsedEmail,
  paymentFailedEmail,
  reminderDue,
  renewalReminderEmail,
  type EmailContent,
  type EmailKind,
} from "./emails";
import type { Admin } from "./plans.server";

const CONTEXT = `#graphql
  query membershipEmailContext($customerId: ID!) {
    shop {
      name
    }
    customer(id: $customerId) {
      firstName
      defaultEmailAddress {
        emailAddress
      }
    }
  }`;

async function deliver(to: string, email: EmailContent): Promise<"LOGGED" | "SENT"> {
  console.log(`email (not sent, no provider yet) to ${to}: ${email.subject}\n${email.text}`);
  return "LOGGED";
}

const longDate = (d: Date) =>
  d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

const money = (amount: string | null, currency: string | null) =>
  amount && currency
    ? new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount))
    : amount;

/**
 * Send one email about a membership, at most once per `key`. Returns false
 * when it was already sent or the member has no email address.
 */
async function notify(
  admin: Admin,
  membershipId: string,
  kind: EmailKind,
  key: string,
  build: (ctx: { shopName: string; firstName: string | null; planName: string }) => EmailContent,
): Promise<boolean> {
  const already = await prisma.emailLog.findUnique({
    where: { membershipId_kind_key: { membershipId, kind, key } },
  });
  if (already) return false;

  const m = await prisma.membership.findUniqueOrThrow({
    where: { id: membershipId },
    include: { plan: { select: { name: true } } },
  });
  const data = (
    await (await admin.graphql(CONTEXT, { variables: { customerId: m.customerId } })).json()
  ).data;
  const to: string | undefined = data?.customer?.defaultEmailAddress?.emailAddress;
  if (!to) {
    console.warn(`membership ${m.id}: no email address for ${kind}`);
    return false;
  }

  const email = build({
    shopName: data.shop.name,
    firstName: data.customer.firstName ?? null,
    planName: m.plan.name,
  });
  // Recorded before delivery: a crash after this can't send it twice.
  await prisma.emailLog.create({
    data: { membershipId, kind, key, to, subject: email.subject, delivery: "PENDING" },
  });
  const delivery = await deliver(to, email);
  await prisma.emailLog.update({
    where: { membershipId_kind_key: { membershipId, kind, key } },
    data: { delivery },
  });
  return true;
}

/** Tell a member a payment failed, and when the next try is (if any). */
export async function notifyPaymentFailed(
  admin: Admin,
  membershipId: string,
  failedAttempts: number,
  retryAt: Date | null,
) {
  return notify(admin, membershipId, "PAYMENT_FAILED", emailKey("PAYMENT_FAILED", { failedAttempts }), (ctx) =>
    paymentFailedEmail({ ...ctx, retryDate: retryAt ? longDate(retryAt) : null }),
  );
}

/** Tell a member their membership ended because payment failed. */
export async function notifyLapsed(admin: Admin, membershipId: string) {
  return notify(admin, membershipId, "LAPSED", emailKey("LAPSED"), (ctx) => lapsedEmail(ctx));
}

/** Send renewal reminders that are due in a shop. Returns how many went out. */
export async function sendDueReminders(admin: Admin, shop: string, now = new Date()) {
  const candidates = await prisma.membership.findMany({
    where: { shop, status: "ACTIVE", contractStatus: "ACTIVE", nextRenewalAt: { gt: now } },
  });
  let sent = 0;
  for (const m of candidates) {
    if (!m.nextRenewalAt || !reminderDue(m.nextRenewalAt, now)) continue;
    const renewalAt = m.nextRenewalAt;
    try {
      const went = await notify(
        admin,
        m.id,
        "RENEWAL_REMINDER",
        emailKey("RENEWAL_REMINDER", { renewalAt }),
        (ctx) =>
          renewalReminderEmail({
            ...ctx,
            renewalDate: longDate(renewalAt),
            amount: money(m.nextRenewalAmount, m.currency),
          }),
      );
      if (went) sent += 1;
    } catch (error) {
      console.error(`renewal reminder for membership ${m.id} failed:`, error);
    }
  }
  return sent;
}

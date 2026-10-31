// Sending member emails: who to, once only, and through which channel.
//
// Emails go out over SMTP, set like PHPMailer in Moodle, from these settings
// in .env: SMTP_HOST, SMTP_PORT (465 = SSL, 587 = STARTTLS), SMTP_USER,
// SMTP_PASS and EMAIL_FROM (the address, e.g. membership@biruh.org). Each
// email is sent in the store's name, with replies going to the store.
// Without SMTP_HOST, emails are written to the server log and recorded in
// EmailLog as LOGGED, so timing and wording can still be checked.
//
// The query is validated against the 2026-10 Admin API schema.
import nodemailer from "nodemailer";
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
      contactEmail
    }
    customer(id: $customerId) {
      firstName
      defaultEmailAddress {
        emailAddress
      }
    }
  }`;

let transport: nodemailer.Transporter | null | undefined;

function smtp() {
  if (transport !== undefined) return transport;
  const host = process.env.SMTP_HOST;
  if (!host || !process.env.EMAIL_FROM) {
    transport = null;
    return transport;
  }
  const port = Number(process.env.SMTP_PORT ?? 465);
  transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
      : undefined,
  });
  return transport;
}

async function deliver(
  to: string,
  email: EmailContent,
  from: { shopName: string; replyTo: string | null },
): Promise<"LOGGED" | "SENT"> {
  const mailer = smtp();
  if (!mailer) {
    console.log(`email (not sent, SMTP not set up) to ${to}: ${email.subject}\n${email.text}`);
    return "LOGGED";
  }
  await mailer.sendMail({
    from: { name: from.shopName, address: process.env.EMAIL_FROM! },
    replyTo: from.replyTo ?? undefined,
    to,
    subject: email.subject,
    text: email.text,
  });
  console.log(`email sent to ${to}: ${email.subject}`);
  return "SENT";
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
  const delivery = await deliver(to, email, {
    shopName: data.shop.name,
    replyTo: data.shop.contactEmail ?? null,
  });
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

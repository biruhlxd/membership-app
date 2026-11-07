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
  credentialExpiringEmail,
  credentialIssuedEmail,
  credentialPendingEmail,
  emailKey,
  lapsedEmail,
  membershipPageUrl,
  MEMBERSHIP_PAGE_ID,
  paymentFailedEmail,
  reminderDue,
  renewalReminderEmail,
  seatInviteEmail,
  welcomeEmail,
  type EmailContent,
  type EmailKind,
} from "./emails";
import type { Admin } from "./plans.server";
import { sealField } from "./dataCrypto.server";

const CONTEXT = `#graphql
  query membershipEmailContext($customerId: ID!) {
    shop {
      name
      contactEmail
      customerAccountsV2 {
        url
      }
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
  // In development the settings live in .env; on the host they are set as
  // the Node.js app's environment variables.
  if (!process.env.SMTP_HOST && process.env.NODE_ENV !== "production") {
    try {
      process.loadEnvFile();
    } catch {
      // No .env: emails are logged only.
    }
  }
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
    // No addresses or email bodies in the log: they are personal data.
    console.log(`email not sent (SMTP not set up): ${email.subject}`);
    return "LOGGED";
  }
  await mailer.sendMail({
    from: { name: from.shopName, address: process.env.EMAIL_FROM! },
    replyTo: from.replyTo ?? undefined,
    to,
    subject: email.subject,
    text: email.text,
  });
  console.log(`email sent: ${email.subject}`);
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
  build: (ctx: {
    shopName: string;
    firstName: string | null;
    planName: string;
    accountUrl: string | null;
  }) => EmailContent,
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
    // Straight to the Membership page; the dev app's page has its own id.
    accountUrl: data.shop.customerAccountsV2?.url
      ? membershipPageUrl(data.shop.customerAccountsV2.url, process.env.MEMBERSHIP_PAGE_ID || MEMBERSHIP_PAGE_ID)
      : null,
  });
  // Recorded before delivery: a crash after this can't send it twice.
  await prisma.emailLog.create({
    data: { membershipId, kind, key, to: sealField(to), subject: email.subject, delivery: "PENDING" },
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

/** How long after joining the welcome email may still go out (webhook retries, a slow first sync). */
const WELCOME_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Welcome a new member with the link to their Membership page, once. Members
 * who joined before this email existed don't get it late.
 */
export async function notifyWelcome(admin: Admin, membershipId: string, now = new Date()) {
  const m = await prisma.membership.findUnique({ where: { id: membershipId } });
  if (!m || m.status !== "ACTIVE") return false;
  if (now.getTime() - m.createdAt.getTime() > WELCOME_WINDOW_MS) return false;
  return notify(admin, membershipId, "WELCOME", emailKey("WELCOME"), (ctx) =>
    welcomeEmail({
      ...ctx,
      renewalDate: m.nextRenewalAt ? longDate(m.nextRenewalAt) : null,
      amount: money(m.nextRenewalAmount, m.currency),
    }),
  );
}

/**
 * The merchant sends the welcome email again, to the customer's current
 * address (after fixing a typo, say). Active members only; false if one was
 * already resent in the last few minutes.
 */
export async function resendWelcome(admin: Admin, membershipId: string, now = new Date()) {
  const m = await prisma.membership.findUnique({ where: { id: membershipId } });
  if (!m || m.status !== "ACTIVE") return false;
  return notify(admin, membershipId, "WELCOME", emailKey("WELCOME", { resendAt: now }), (ctx) =>
    welcomeEmail({
      ...ctx,
      renewalDate: m.nextRenewalAt ? longDate(m.nextRenewalAt) : null,
      amount: money(m.nextRenewalAmount, m.currency),
    }),
  );
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

const INVITE_CONTEXT = `#graphql
  query membershipInviteContext($adminId: ID!) {
    shop {
      name
      contactEmail
    }
    customer(id: $adminId) {
      displayName
    }
  }`;

/**
 * Email someone their seat invitation, once per seat. Unlike the other
 * emails it goes to the invited address, not the membership's customer.
 */
export async function notifySeatInvite(
  admin: Admin,
  seat: { id: string; email: string; seatName: string },
  organization: { membershipId: string; adminCustomerId: string },
): Promise<boolean> {
  const key = emailKey("SEAT_INVITE", { seatId: seat.id });
  const where = {
    membershipId_kind_key: { membershipId: organization.membershipId, kind: "SEAT_INVITE", key },
  };
  if (await prisma.emailLog.findUnique({ where })) return false;

  const data = (
    await (
      await admin.graphql(INVITE_CONTEXT, { variables: { adminId: organization.adminCustomerId } })
    ).json()
  ).data;
  const email = seatInviteEmail({
    shopName: data.shop.name,
    inviterName: data.customer?.displayName ?? null,
    seatName: seat.seatName,
  });
  await prisma.emailLog.create({
    data: {
      membershipId: organization.membershipId,
      kind: "SEAT_INVITE",
      key,
      to: sealField(seat.email),
      subject: email.subject,
      delivery: "PENDING",
    },
  });
  const delivery = await deliver(seat.email, email, {
    shopName: data.shop.name,
    replyTo: data.shop.contactEmail ?? null,
  });
  await prisma.emailLog.update({ where, data: { delivery } });
  return true;
}

export type CredentialEmail = "PENDING" | "ISSUED" | "EXPIRING";

const CREDENTIAL_SENT_FIELD = {
  PENDING: "pendingEmailAt",
  ISSUED: "issuedEmailAt",
  EXPIRING: "expiringEmailAt",
} as const;

/**
 * Email a credential's holder that it is being reviewed, was issued, or
 * expires soon; each at most once (the time is recorded on the credential
 * before sending). Returns false when already sent or there is no address.
 */
export async function notifyCredential(admin: Admin, credentialId: string, kind: CredentialEmail): Promise<boolean> {
  const field = CREDENTIAL_SENT_FIELD[kind];
  // Claim the email first: two runs at once can't both send it.
  const claimed = await prisma.credential.updateMany({
    where: { id: credentialId, [field]: null },
    data: { [field]: new Date() },
  });
  if (claimed.count !== 1) return false;
  const credential = await prisma.credential.findUniqueOrThrow({ where: { id: credentialId }, include: { type: true } });
  const data = (
    await (await admin.graphql(CONTEXT, { variables: { customerId: credential.customerId } })).json()
  ).data;
  const to: string | undefined = data?.customer?.defaultEmailAddress?.emailAddress;
  if (!to) return false;
  const base = { shopName: data.shop.name, firstName: data.customer.firstName ?? null, typeName: credential.type.name };
  const email =
    kind === "PENDING"
      ? credentialPendingEmail(base)
      : kind === "ISSUED"
        ? credentialIssuedEmail({
            ...base,
            number: credential.number ?? "",
            expiresAt: credential.expiresAt,
            verifyUrl: `${process.env.SHOPIFY_APP_URL ?? ""}/verify/${credential.verifyCode}`,
          })
        : credentialExpiringEmail({ ...base, number: credential.number ?? "", expiresAt: credential.expiresAt! });
  await deliver(to, email, { shopName: data.shop.name, replyTo: data.shop.contactEmail ?? null });
  return true;
}

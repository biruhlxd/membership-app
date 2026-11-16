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
  type EmailContent,
  type EmailKind,
} from "./emails";
import type { Admin } from "./plans.server";
import { sealField } from "./dataCrypto.server";
import {
  DEFAULT_LOOK,
  DEFAULTS,
  render,
  safeColor,
  safeLogo,
  safePath,
  SAMPLE,
  signInUrl,
  type Look,
  type Template,
  type TemplateKind,
  type Vars,
} from "./emailTemplates";

const CONTEXT = `#graphql
  query membershipEmailContext($customerId: ID!) {
    shop {
      name
      contactEmail
      primaryDomain {
        url
      }
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
  // EMAIL_DIVERT_TO (test servers, like Moodle's divertallemailsto): every
  // email goes to that address instead, the real recipient in the subject.
  const divert = process.env.EMAIL_DIVERT_TO;
  if (divert) {
    email = { ...email, subject: `[to ${to}] ${email.subject}` };
    to = divert;
  }
  await mailer.sendMail({
    from: { name: from.shopName, address: process.env.EMAIL_FROM! },
    // EMAIL_REPLY_TO: one reply address for the whole server (a single-store
    // copy); otherwise the shop's contact email.
    replyTo: process.env.EMAIL_REPLY_TO || from.replyTo || undefined,
    to,
    subject: email.subject,
    text: email.text,
    html: email.html,
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
/**
 * Emails the server never sends (env EMAILS_OFF, e.g. "WELCOME"): for a
 * single-store copy where another system already sends them (USSEA's
 * welcome comes from its own onboarding).
 */
function emailsOff(): Set<string> {
  return new Set((process.env.EMAILS_OFF ?? "").split(",").map((k) => k.trim().toUpperCase()).filter(Boolean));
}

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
    storeUrl: string;
    look: Look;
  }) => EmailContent,
): Promise<boolean> {
  if (emailsOff().has(kind)) return false;
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

  const look = await lookFor(m.shop);
  const email = build({
    look,
    storeUrl: data.shop.primaryDomain?.url ?? `https://${m.shop}`,
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
    shopName: look.senderName || data.shop.name,
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
/** How long the welcome waits for Moodle's "account ready" before going anyway. */
export const WELCOME_WAIT_MS = 10 * 60 * 1000;

/**
 * Welcome a new member. With a Moodle link (MOODLE_LINK_SECRET), the email
 * waits until Moodle says the account is ready (welcomeReady), so its sign-in
 * button works the moment it arrives; after WELCOME_WAIT_MS it goes anyway
 * (sendDueWelcomes). Without one it goes now.
 */
export async function notifyWelcome(admin: Admin, membershipId: string, now = new Date()) {
  if (!process.env.MOODLE_LINK_SECRET) return sendWelcome(admin, membershipId, now);
  const m = await prisma.membership.findUnique({ where: { id: membershipId } });
  if (!m || m.welcomeDueAt || m.status !== "ACTIVE") return false;
  if (await prisma.emailLog.findUnique({ where: { membershipId_kind_key: { membershipId, kind: "WELCOME", key: emailKey("WELCOME") } } })) {
    return false;
  }
  await prisma.membership.update({ where: { id: m.id }, data: { welcomeDueAt: new Date(now.getTime() + WELCOME_WAIT_MS) } });
  return false;
}

/** Moodle says this customer's account is ready: send their waiting welcome. */
export async function welcomeReady(admin: Admin, shop: string, customerId: string, now = new Date()) {
  const waiting = await prisma.membership.findMany({ where: { shop, customerId, welcomeDueAt: { not: null } }, select: { id: true } });
  let sent = 0;
  for (const { id } of waiting) {
    await prisma.membership.update({ where: { id }, data: { welcomeDueAt: null } });
    if (await sendWelcome(admin, id, now)) sent++;
  }
  return sent;
}

/** Welcomes whose wait for Moodle is over (the email job, every few minutes). */
export async function sendDueWelcomes(admin: Admin, shop: string, now = new Date()) {
  const due = await prisma.membership.findMany({ where: { shop, welcomeDueAt: { lte: now } }, select: { id: true } });
  let sent = 0;
  for (const { id } of due) {
    await prisma.membership.update({ where: { id }, data: { welcomeDueAt: null } });
    if (await sendWelcome(admin, id, now)) sent++;
  }
  return sent;
}

async function sendWelcome(admin: Admin, membershipId: string, now: Date) {
  const m = await prisma.membership.findUnique({ where: { id: membershipId } });
  if (!m || m.status !== "ACTIVE") return false;
  if (now.getTime() - m.createdAt.getTime() > WELCOME_WINDOW_MS) return false;
  // Members moved in from another app (import.server.ts) already are
  // members. PENDING: the contract webhook can beat the import's own record.
  const imported = await prisma.contractImport.findFirst({
    where: { shop: m.shop, customerId: m.customerId, OR: [{ contractId: m.contractId }, { status: "PENDING" }] },
    select: { id: true },
  });
  if (imported) return false;
  const template = await templateFor(m.shop, "WELCOME", m.planId);
  if (!template.enabled) return false;
  return notify(admin, membershipId, "WELCOME", emailKey("WELCOME"), (ctx) => welcomeContent(ctx, m, template));
}

/**
 * The merchant sends the welcome email again, to the customer's current
 * address (after fixing a typo, say). Active members only; false if one was
 * already resent in the last few minutes.
 */
export async function resendWelcome(admin: Admin, membershipId: string, now = new Date()) {
  const m = await prisma.membership.findUnique({ where: { id: membershipId } });
  if (!m || m.status !== "ACTIVE") return false;
  const template = await templateFor(m.shop, "WELCOME", m.planId);
  return notify(admin, membershipId, "WELCOME", emailKey("WELCOME", { resendAt: now }), (ctx) =>
    welcomeContent(ctx, m, template),
  );
}

type Ctx = Parameters<Parameters<typeof notify>[4]>[0];

function welcomeContent(
  ctx: Ctx,
  m: { nextRenewalAt: Date | null; nextRenewalAmount: string | null; currency: string | null },
  template: Template,
): EmailContent {
  return render(template, varsFor(ctx, m), ctx.look);
}

function varsFor(
  ctx: Ctx,
  m: { nextRenewalAt: Date | null; nextRenewalAmount: string | null; currency: string | null },
): Vars {
  return {
    first_name: ctx.firstName || "there",
    plan_name: ctx.planName,
    shop_name: ctx.shopName,
    renewal_date: m.nextRenewalAt ? longDate(m.nextRenewalAt) : "",
    amount: money(m.nextRenewalAmount, m.currency) ?? "",
    sign_in_url: signInUrl(ctx.storeUrl, ctx.look.signInPath),
    membership_page_url: ctx.accountUrl ?? `${ctx.storeUrl}/account`,
    store_url: ctx.storeUrl,
    button_color: safeColor(ctx.look.buttonColor),
    organization_name: "",
    seat_type: "",
  };
}

// ── Editable templates and the look (Emails page) ───────────────────────────

/** The template for one email of one plan: the merchant's, else the default. */
export async function templateFor(
  shop: string,
  kind: TemplateKind,
  planId = "",
): Promise<Template & { custom: boolean }> {
  const row = await prisma.emailTemplate.findUnique({ where: { shop_kind_planId: { shop, kind, planId } } });
  if (row) return { enabled: row.enabled, subject: row.subject, html: row.html, custom: true };
  const d = DEFAULTS[kind];
  return { enabled: d.enabled, subject: d.subject, html: d.html, custom: false };
}

export async function saveTemplate(shop: string, kind: TemplateKind, planId: string, t: Template): Promise<void> {
  const data = { enabled: t.enabled, subject: t.subject, html: t.html };
  await prisma.emailTemplate.upsert({
    where: { shop_kind_planId: { shop, kind, planId } },
    create: { shop, kind, planId, ...data },
    update: data,
  });
}

export async function resetTemplate(shop: string, kind: TemplateKind, planId: string): Promise<void> {
  await prisma.emailTemplate.deleteMany({ where: { shop, kind, planId } });
}

export async function lookFor(shop: string): Promise<Look> {
  const row = await prisma.emailLook.findUnique({ where: { shop } });
  return row ? { ...row, footerHtml: row.footerHtml ?? "" } : { ...DEFAULT_LOOK };
}

/** Save the look; returns a problem to show, or null. */
export async function saveLook(shop: string, look: Look): Promise<string | null> {
  if (look.logoUrl.trim() && !safeLogo(look.logoUrl)) return "The logo must be an https image address.";
  if (look.accentColor.trim() && !safeColor(look.accentColor, "")) return "The accent colour must look like #c8102e.";
  if (!safeColor(look.buttonColor, "")) return "The button colour must look like #002868.";
  if (safePath(look.signInPath) !== look.signInPath.trim()) return "The sign-in page must be a path on your store, like /pages/member-portal.";
  if (look.footerHtml.length > 2000 || look.senderName.length > 100) return "Keep the footer under 2,000 characters and the sender name under 100.";
  const data = {
    senderName: look.senderName.trim(),
    logoUrl: look.logoUrl.trim(),
    accentColor: look.accentColor.trim(),
    buttonColor: look.buttonColor.trim(),
    footerHtml: look.footerHtml.trim() || null,
    signInPath: look.signInPath.trim(),
  };
  await prisma.emailLook.upsert({ where: { shop }, create: { shop, ...data }, update: data });
  return null;
}

const SHOP_FOR_EMAILS = `#graphql
  query membershipShopForEmails {
    shop {
      name
      contactEmail
      primaryDomain {
        url
      }
      customerAccountsV2 {
        url
      }
    }
  }`;

async function sampleFor(admin: Admin, shop: string, planName: string) {
  const data = (await (await admin.graphql(SHOP_FOR_EMAILS)).json()).data?.shop;
  const look = await lookFor(shop);
  const storeUrl: string = data?.primaryDomain?.url ?? `https://${shop}`;
  const vars: Vars = {
    ...SAMPLE,
    plan_name: planName || SAMPLE.plan_name,
    shop_name: data?.name ?? SAMPLE.shop_name,
    sign_in_url: signInUrl(storeUrl, look.signInPath),
    membership_page_url: data?.customerAccountsV2?.url
      ? membershipPageUrl(data.customerAccountsV2.url, process.env.MEMBERSHIP_PAGE_ID || MEMBERSHIP_PAGE_ID)
      : SAMPLE.membership_page_url,
    store_url: storeUrl,
    button_color: safeColor(look.buttonColor),
  };
  return { vars, look, contactEmail: (data?.contactEmail as string | null) ?? null, shopName: (data?.name as string) ?? shop };
}

/** The draft as a member would get it, with sample values. */
export async function previewEmail(admin: Admin, shop: string, planName: string, draft: Pick<Template, "subject" | "html">) {
  const { vars, look } = await sampleFor(admin, shop, planName);
  const r = render(draft, vars, look);
  return { subject: r.subject, html: r.html };
}

/** Send the draft, with sample values, to the reply-to address or the store's contact email. */
export async function sendTestEmail(
  admin: Admin,
  shop: string,
  planName: string,
  draft: Pick<Template, "subject" | "html">,
): Promise<{ ok: true; to: string } | { ok: false; message: string }> {
  const { vars, look, contactEmail, shopName } = await sampleFor(admin, shop, planName);
  const to = process.env.EMAIL_REPLY_TO || contactEmail;
  if (!to) return { ok: false, message: "Your store has no contact email to send the test to." };
  const r = render(draft, vars, look);
  const delivery = await deliver(to, { ...r, subject: `[Test] ${r.subject}` }, { shopName: look.senderName || shopName, replyTo: contactEmail });
  return delivery === "SENT" ? { ok: true, to } : { ok: false, message: "Email sending isn't set up on the server, so the test was only logged." };
}

/**
 * Welcome someone an organization gave a seat to (Moodle's seat_assigned
 * message). They have no membership in this app, so the once-only check is
 * Moodle's event id (moodleLink.server.ts), not EmailLog.
 */
export async function sendSeatWelcome(
  admin: Admin,
  shop: string,
  seat: { email: string; firstName: string; organizationName: string; seatType: string },
): Promise<boolean> {
  const template = await templateFor(shop, "SEAT_WELCOME");
  if (!template.enabled || !seat.email.includes("@")) return false;
  const { vars, look, contactEmail, shopName } = await sampleFor(admin, shop, "");
  const r = render(
    template,
    {
      ...vars,
      first_name: seat.firstName || "there",
      plan_name: "",
      renewal_date: "",
      amount: "",
      organization_name: seat.organizationName,
      seat_type: seat.seatType,
    },
    look,
  );
  const delivery = await deliver(seat.email, r, { shopName: look.senderName || shopName, replyTo: contactEmail });
  return delivery === "SENT";
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

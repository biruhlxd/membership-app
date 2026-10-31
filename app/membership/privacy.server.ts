// Shopify's mandatory privacy webhooks: what the app holds about a customer,
// and deleting it. See https://shopify.dev/docs/apps/build/privacy-law-compliance
//
// What the app stores per customer: their Shopify customer id on each
// Membership (plan, status, dates), the BillingAttempt rows for those
// memberships, and EmailLog rows (the address each email went to and its
// subject). No names or card details are stored.
import prisma from "../db.server";

const customerGid = (id: number | string) => `gid://shopify/Customer/${id}`;

/** Everything the app holds about one customer in one shop. */
export async function customerData(shop: string, customerId: number | string) {
  const memberships = await prisma.membership.findMany({
    where: { shop, customerId: customerGid(customerId) },
    select: {
      contractId: true,
      status: true,
      contractStatus: true,
      createdAt: true,
      lastPaidAt: true,
      nextRenewalAt: true,
      plan: { select: { name: true, tag: true } },
      billingAttempts: {
        select: { cycleIndex: true, attempt: true, state: true, orderId: true, createdAt: true },
      },
    },
  });
  const ids = (
    await prisma.membership.findMany({
      where: { shop, customerId: customerGid(customerId) },
      select: { id: true },
    })
  ).map((m) => m.id);
  const emails = await prisma.emailLog.findMany({
    where: { membershipId: { in: ids } },
    select: { kind: true, to: true, subject: true, createdAt: true },
  });
  return { shop, customerId: customerGid(customerId), memberships, emails };
}

/** Delete one customer's memberships, billing attempts and email records. */
export async function redactCustomer(shop: string, customerId: number | string) {
  const where = { shop, customerId: customerGid(customerId) };
  const ids = (await prisma.membership.findMany({ where, select: { id: true } })).map(
    (m) => m.id,
  );
  const [emails, attempts, memberships] = await prisma.$transaction([
    prisma.emailLog.deleteMany({ where: { membershipId: { in: ids } } }),
    prisma.billingAttempt.deleteMany({ where: { membershipId: { in: ids } } }),
    prisma.membership.deleteMany({ where }),
  ]);
  return { emails: emails.count, attempts: attempts.count, memberships: memberships.count };
}

/** Delete everything the app holds for a shop (48 hours after uninstall). */
export async function redactShop(shop: string) {
  const ids = (
    await prisma.membership.findMany({ where: { shop }, select: { id: true } })
  ).map((m) => m.id);
  const [emails, attempts, memberships, plans, sessions] = await prisma.$transaction([
    prisma.emailLog.deleteMany({ where: { membershipId: { in: ids } } }),
    prisma.billingAttempt.deleteMany({ where: { membershipId: { in: ids } } }),
    prisma.membership.deleteMany({ where: { shop } }),
    prisma.membershipPlan.deleteMany({ where: { shop } }),
    prisma.session.deleteMany({ where: { shop } }),
  ]);
  return {
    emails: emails.count,
    attempts: attempts.count,
    memberships: memberships.count,
    plans: plans.count,
    sessions: sessions.count,
  };
}

import { fakeAdmin, testPrisma as prisma } from "../test/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Never send real email from tests.
const sent = vi.hoisted(() => [] as { to: string; subject: string; html?: string }[]);
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: async (m: (typeof sent)[number]) => void sent.push(m) }) },
}));
import { handleMoodleMessage, signMoodleMessage, verifyMoodleMessage } from "./moodleLink.server";
import { notifyWelcome, sendDueWelcomes, WELCOME_WAIT_MS } from "./emails.server";
import { endOnRefund } from "./contracts.server";
import { writeRenewalDate } from "./renewals.server";

const SHOP = "ussea-dev-store.myshopify.com";
const ANA = "gid://shopify/Customer/77";
const SECRET = "s".repeat(43);
process.env.SMTP_HOST = "smtp.test.invalid";
process.env.EMAIL_FROM = "membership@test.invalid";

const shopify = (order: unknown = null) =>
  fakeAdmin((query) => {
    if (query.includes("membershipEmailContext") || query.includes("membershipShopForEmails")) {
      return {
        data: {
          shop: { name: "USSEA", contactEmail: "staff@ussea.test", primaryDomain: { url: "https://ussea.us" }, customerAccountsV2: null },
          customer: { firstName: "Ana", defaultEmailAddress: { emailAddress: "ana@example.com" } },
        },
      };
    }
    if (query.includes("membershipRefundedOrder")) return { data: { order } };
    if (query.includes("membershipContractCancel")) return { data: { subscriptionContractCancel: { contract: null, userErrors: [] } } };
    if (query.includes("membershipCustomerTags")) return { data: { customer: { id: ANA, tags: ["ussea-instructor"] } } };
    return { data: { tagsAdd: { userErrors: [] }, tagsRemove: { userErrors: [] }, metafieldsSet: { userErrors: [] }, metafieldsDelete: { userErrors: [] } } };
  });

let planId = "";
let membershipId = "";

beforeEach(async () => {
  sent.length = 0;
  process.env.MOODLE_LINK_SECRET = SECRET;
  for (const table of ["moodleEvent", "emailLog", "emailTemplate", "membership", "membershipPlan"] as const) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma[table] as any).deleteMany();
  }
  planId = (
    await prisma.membershipPlan.create({
      data: { shop: SHOP, name: "Instructor Certification", sellingPlanId: "gid://shopify/SellingPlan/1", tag: "ussea-instructor" },
    })
  ).id;
  membershipId = (
    await prisma.membership.create({
      data: { shop: SHOP, contractId: "gid://shopify/SubscriptionContract/1", customerId: ANA, planId, contractStatus: "ACTIVE", status: "ACTIVE" },
    })
  ).id;
});

afterEach(() => {
  delete process.env.MOODLE_LINK_SECRET;
});

describe("signed messages", () => {
  const claims = { shop: SHOP, id: "e1", type: "account_ready", customer: ANA };

  it("accepts a correctly signed, fresh message", () => {
    expect(verifyMoodleMessage(signMoodleMessage(claims, SECRET), SECRET)).toMatchObject(claims);
  });

  it("refuses a wrong signature, a changed body, an expired or far-future message, a short secret", () => {
    const token = signMoodleMessage(claims, SECRET);
    expect(verifyMoodleMessage(token, "x".repeat(43))).toBeNull();
    const [body, sig] = token.split(".");
    const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), customer: "gid://shopify/Customer/1" })).toString("base64url");
    expect(verifyMoodleMessage(`${changed}.${sig}`, SECRET)).toBeNull();
    expect(verifyMoodleMessage(signMoodleMessage(claims, SECRET, 60, Date.now() - 120_000), SECRET)).toBeNull();
    expect(verifyMoodleMessage(signMoodleMessage(claims, SECRET, 3600), SECRET)).toBeNull();
    expect(verifyMoodleMessage(signMoodleMessage(claims, "short"), "short")).toBeNull();
  });
});

describe("welcome waits for Moodle", () => {
  it("holds the welcome until account_ready, then sends it once", async () => {
    const { admin } = shopify();
    expect(await notifyWelcome(admin, membershipId)).toBe(false);
    expect(sent).toHaveLength(0);
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: membershipId } })).welcomeDueAt).not.toBeNull();

    const claims = { shop: SHOP, id: "e1", type: "account_ready", customer: ANA, exp: 0 };
    expect(await handleMoodleMessage(admin, claims)).toBe("1 welcome sent");
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("Welcome to your Instructor Certification");

    // The same Moodle event again, and a later one: nothing more.
    expect(await handleMoodleMessage(admin, claims)).toBe("already handled");
    expect(await handleMoodleMessage(admin, { ...claims, id: "e2" })).toBe("0 welcome sent");
    expect(await notifyWelcome(admin, membershipId)).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("sends anyway when Moodle stays quiet past the wait", async () => {
    const { admin } = shopify();
    const now = new Date();
    await notifyWelcome(admin, membershipId, now);
    expect(await sendDueWelcomes(admin, SHOP, new Date(now.getTime() + WELCOME_WAIT_MS - 1000))).toBe(0);
    expect(await sendDueWelcomes(admin, SHOP, new Date(now.getTime() + WELCOME_WAIT_MS + 1000))).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("sends at once without a Moodle link", async () => {
    delete process.env.MOODLE_LINK_SECRET;
    expect(await notifyWelcome(shopify().admin, membershipId)).toBe(true);
    expect(sent).toHaveLength(1);
  });
});

describe("seat_assigned", () => {
  it("sends the sub-account welcome", async () => {
    const result = await handleMoodleMessage(shopify().admin, {
      shop: SHOP,
      id: "seat-9",
      type: "seat_assigned",
      exp: 0,
      email: "Bo@Example.com",
      first_name: "Bo",
      organization: "Castle Rock Fire and Rescue",
      seat_type: "Coach",
    });
    expect(result).toBe("sub-account welcome sent");
    expect(sent[0]).toMatchObject({ to: "bo@example.com", subject: "Castle Rock Fire and Rescue added you to USSEA" });
    expect(sent[0].html).toContain("a Coach seat with USSEA");
  });
});

describe("full refund", () => {
  const order = (status: string) => ({
    displayFinancialStatus: status,
    customer: { id: ANA },
    lineItems: { nodes: [{ sellingPlan: { sellingPlanId: "gid://shopify/SellingPlan/1" } }, { sellingPlan: null }] },
  });

  it("ends the membership at once and cancels the contract", async () => {
    const { admin, calls } = shopify(order("REFUNDED"));
    expect(await endOnRefund(admin, SHOP, "gid://shopify/Order/5")).toEqual([membershipId]);
    const m = await prisma.membership.findUniqueOrThrow({ where: { id: membershipId } });
    expect(m).toMatchObject({ status: "CANCELLED", contractStatus: "CANCELLED" });
    expect(m.accessEndsAt!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(calls.some((c) => c.query.includes("membershipContractCancel"))).toBe(true);
    expect(calls.find((c) => c.query.includes("membershipTagsRemove"))?.variables).toMatchObject({ tags: ["ussea-instructor"] });
  });

  it("leaves a partial refund alone", async () => {
    expect(await endOnRefund(shopify(order("PARTIALLY_REFUNDED")).admin, SHOP, "gid://shopify/Order/5")).toEqual([]);
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: membershipId } })).status).toBe("ACTIVE");
  });
});

describe("renewal date metafield", () => {
  it("writes the latest active renewal date, and removes it when none", async () => {
    await prisma.membership.update({ where: { id: membershipId }, data: { nextRenewalAt: new Date("2027-11-16T12:00:00Z") } });
    const first = shopify();
    await writeRenewalDate(first.admin, SHOP, ANA);
    expect(first.calls.find((c) => c.query.includes("membershipRenewalMetafield("))?.variables).toEqual({
      metafields: [{ ownerId: ANA, namespace: "membership", key: "renews_on", type: "date", value: "2027-11-16" }],
    });

    await prisma.membership.update({ where: { id: membershipId }, data: { contractStatus: "CANCELLED" } });
    const second = shopify();
    await writeRenewalDate(second.admin, SHOP, ANA);
    expect(second.calls.find((c) => c.query.includes("membershipRenewalMetafieldDelete"))?.variables).toEqual({
      metafields: [{ ownerId: ANA, namespace: "membership", key: "renews_on" }],
    });
  });
});

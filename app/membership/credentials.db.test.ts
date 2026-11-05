import { fakeAdmin, testPrisma as prisma } from "../test/db";
import { beforeEach, describe, expect, it } from "vitest";
import { evaluateCustomer, expireDue, issue, renewalCheck } from "./credentials.server";
import { emailHash, openField, sealLegacyData } from "./dataCrypto.server";
import { createPlan } from "./plans.server";
import { saveAppPlan } from "./appBilling.server";
import { STARTER } from "./appPlans";

const SHOP = "test-shop.myshopify.com";
const ANA = "gid://shopify/Customer/77";
const BEN = "gid://shopify/Customer/78";
const YEAR = new Date().getUTCFullYear();

const shopify = () => fakeAdmin(() => ({ data: { tagsAdd: { userErrors: [] }, tagsRemove: { userErrors: [] } } }));
const facts = (tags: string[]) => ({ tags, firstName: "Ana", lastName: "bekele" });

let planId = "";

beforeEach(async () => {
  for (const table of ["credential", "credentialType", "seat", "organization", "emailLog", "membership", "membershipPlan", "shopAppPlan"] as const) {
    await (prisma[table] as unknown as { deleteMany: () => Promise<unknown> }).deleteMany();
  }
  planId = (
    await prisma.membershipPlan.create({
      data: { shop: SHOP, name: "Coach plan", sellingPlanId: "gid://shopify/SellingPlan/1", tag: "coach-member" },
    })
  ).id;
});

async function coachType(data: Partial<{ needsApproval: boolean; validityMonths: number; renewalRule: string; requirements: string }> = {}) {
  return prisma.credentialType.create({
    data: {
      shop: SHOP,
      name: "Coach Level 1",
      code: "COACH1",
      requirements: JSON.stringify([{ kind: "tag", tag: "completed:coach101" }]),
      renewalPlanIds: JSON.stringify([planId]),
      ...data,
    },
  });
}

describe("earning credentials", () => {
  it("issues at once with a number, an encrypted holder name and the credential tag", async () => {
    await coachType({ validityMonths: 24 });
    const { admin, calls } = shopify();
    expect(await evaluateCustomer(admin, SHOP, ANA, facts(["Completed:COACH101"]))).toEqual(["COACH1"]);
    const credential = await prisma.credential.findFirstOrThrow();
    expect(credential).toMatchObject({ status: "ACTIVE", number: `COACH1-${YEAR}-00001` });
    expect(credential.holderName.startsWith("v1.")).toBe(true);
    expect(openField(credential.holderName)).toBe("Ana B.");
    expect(credential.expiresAt).not.toBeNull();
    expect(calls.at(-1)?.variables).toEqual({ id: ANA, tags: ["credential:coach1"] });

    expect(await evaluateCustomer(admin, SHOP, ANA, facts(["completed:coach101"]))).toEqual([]);
    expect(await prisma.credential.count()).toBe(1);
  });

  it("waits for an approver, then numbers credentials in order", async () => {
    await coachType({ needsApproval: true });
    const { admin } = shopify();
    await evaluateCustomer(admin, SHOP, ANA, facts(["completed:coach101"]));
    await evaluateCustomer(admin, SHOP, BEN, facts(["completed:coach101"]));
    const [a, b] = await prisma.credential.findMany({ orderBy: { createdAt: "asc" } });
    expect([a.status, a.number]).toEqual(["PENDING", null]);
    await issue(admin, SHOP, b.id);
    await issue(admin, SHOP, a.id);
    expect((await prisma.credential.findUniqueOrThrow({ where: { id: b.id } })).number).toBe(`COACH1-${YEAR}-00001`);
    expect((await prisma.credential.findUniqueOrThrow({ where: { id: a.id } })).number).toBe(`COACH1-${YEAR}-00002`);
    expect(await issue(admin, SHOP, a.id)).toBeNull();
  });

  it("can require an active membership", async () => {
    await coachType({ requirements: JSON.stringify([{ kind: "plan", planId: "" }]) });
    await prisma.credentialType.updateMany({ data: { requirements: JSON.stringify([{ kind: "plan", planId }]) } });
    const { admin } = shopify();
    expect(await evaluateCustomer(admin, SHOP, ANA, facts([]))).toEqual([]);
    await prisma.membership.create({
      data: { shop: SHOP, contractId: "gid://shopify/SubscriptionContract/1", customerId: ANA, planId, contractStatus: "ACTIVE", status: "ACTIVE" },
    });
    expect(await evaluateCustomer(admin, SHOP, ANA, facts([]))).toEqual(["COACH1"]);
  });
});

describe("expiry and renewals", () => {
  it("expires credentials past their date and removes the tag", async () => {
    await coachType({ validityMonths: 1 });
    const { admin, calls } = shopify();
    await evaluateCustomer(admin, SHOP, ANA, facts(["completed:coach101"]));
    const twoMonths = new Date(Date.now() + 62 * 24 * 60 * 60 * 1000);
    expect(await expireDue(admin, SHOP, twoMonths)).toBe(1);
    expect((await prisma.credential.findFirstOrThrow()).status).toBe("EXPIRED");
    expect(calls.at(-1)?.query).toContain("tagsRemove");
  });

  it("holds or flags a renewal when the credential isn't active", async () => {
    await coachType({ renewalRule: "block" });
    expect(await renewalCheck(SHOP, ANA, planId)).toEqual({ decision: "block", issue: "Coach Level 1 not active" });
    await prisma.credentialType.updateMany({ data: { renewalRule: "flag" } });
    expect((await renewalCheck(SHOP, ANA, planId)).decision).toBe("flag");
    await evaluateCustomer(shopify().admin, SHOP, ANA, facts(["completed:coach101"]));
    expect(await renewalCheck(SHOP, ANA, planId)).toEqual({ decision: "charge", issue: null });
    expect((await renewalCheck(SHOP, ANA, "another-plan")).decision).toBe("charge");
  });
});

describe("personal data saved before encryption", () => {
  it("is encrypted by the job, once", async () => {
    const membership = await prisma.membership.create({
      data: { shop: SHOP, contractId: "gid://shopify/SubscriptionContract/2", customerId: ANA, planId, contractStatus: "ACTIVE", status: "ACTIVE" },
    });
    const org = await prisma.organization.create({ data: { shop: SHOP, membershipId: membership.id, adminCustomerId: ANA } });
    await prisma.seat.create({ data: { organizationId: org.id, tag: "staff", email: "ben@example.com", status: "INVITED" } });
    await prisma.emailLog.create({ data: { membershipId: membership.id, kind: "LAPSED", key: "k", to: "ana@example.com", subject: "s", delivery: "SENT" } });
    await coachType();
    const type = await prisma.credentialType.findFirstOrThrow();
    await prisma.credential.create({ data: { shop: SHOP, typeId: type.id, customerId: ANA, holderName: "Ana B.", status: "ACTIVE", verifyCode: "abc" } });

    expect(await sealLegacyData()).toBe(3);
    const seat = await prisma.seat.findFirstOrThrow();
    expect(seat.email.startsWith("v1.")).toBe(true);
    expect(openField(seat.email)).toBe("ben@example.com");
    expect(seat.emailHash).toBe(emailHash("Ben@Example.com"));
    expect(openField((await prisma.emailLog.findFirstOrThrow()).to)).toBe("ana@example.com");
    expect(openField((await prisma.credential.findFirstOrThrow()).holderName)).toBe("Ana B.");
    expect(await sealLegacyData()).toBe(0);
  });
});

describe("app plan limits", () => {
  const plan = {
    name: "Gold",
    tag: "gold",
    productId: "gid://shopify/Product/1",
    joiningPrice: 100,
    renewalPrice: 90,
    interval: "YEAR" as const,
    intervalCount: 1,
  };
  const untouched = fakeAdmin(() => {
    throw new Error("Shopify must not be called when the app plan doesn't allow it");
  });

  it("needs an app plan to set up membership plans", async () => {
    const result = await createPlan(untouched.admin, SHOP, plan);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/App plan/);
  });

  it("needs Growth or Association for organization seats", async () => {
    await saveAppPlan(SHOP, STARTER);
    const result = await createPlan(untouched.admin, SHOP, { ...plan, seatTypes: [{ name: "Staff", tag: "staff", seats: 5 }] });
    expect(!result.ok && result.error).toMatch(/Growth/);
    expect(untouched.calls).toHaveLength(0);
  });
});

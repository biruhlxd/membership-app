import { fakeAdmin, testPrisma as prisma } from "../test/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Never send real email from tests.
const sent = vi.hoisted(() => [] as { to: string }[]);
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: async (m: { to: string }) => void sent.push(m) }) },
}));
import { importRow, type PlanSetup } from "./import.server";
import { notifyWelcome, sendTestEmail } from "./emails.server";
import type { ImportRow } from "./import";

const SHOP = "test-shop.myshopify.com";
const ANA = "gid://shopify/Customer/77";
const CONTRACT = "gid://shopify/SubscriptionContract/9";

const setup: PlanSetup = {
  planId: "",
  sellingPlanId: "gid://shopify/SellingPlan/1",
  sellingPlanName: "Basic",
  variantId: "gid://shopify/ProductVariant/5",
  currencyCode: "USD",
  interval: "YEAR",
  intervalCount: 1,
  renewalPrice: "25.00",
};
const row: ImportRow = {
  line: 2,
  sourceId: "101",
  email: "ana@example.com",
  customerId: null,
  plan: "Basic",
  nextBillingDate: "2027-01-15",
  price: null,
  paymentMethodId: null,
  memberSince: "2025-01-15",
  lastPaid: "2026-01-15",
  problems: [],
};

function shopify(
  options: { cards?: { id: string; revokedAt: string | null }[]; refuse?: boolean; firstBilling?: string } = {},
) {
  const customer = { id: ANA, paymentMethods: { nodes: options.cards ?? [{ id: "gid://shopify/CustomerPaymentMethod/c1", revokedAt: null }] } };
  return fakeAdmin((query) => {
    if (query.includes("importCustomer(")) return { data: { customerByIdentifier: customer } };
    if (query.includes("importFirstCycle")) {
      return { data: { subscriptionBillingCycles: { nodes: [{ billingAttemptExpectedDate: `${options.firstBilling ?? row.nextBillingDate}T00:00:00Z` }] } } };
    }
    if (query.includes("importContractCancel")) return { data: { subscriptionContractCancel: { userErrors: [] } } };
    if (query.includes("importContract")) {
      return options.refuse
        ? { data: { subscriptionContractAtomicCreate: { contract: null, userErrors: [{ message: "Payment method is invalid" }] } } }
        : { data: { subscriptionContractAtomicCreate: { contract: { id: CONTRACT }, userErrors: [] } } };
    }
    if (query.includes("membershipContract(")) {
      return { data: { subscriptionContract: { id: CONTRACT, status: "ACTIVE", customer: { id: ANA, tags: [] }, lines: { nodes: [{ sellingPlanId: setup.sellingPlanId }] } } } };
    }
    if (query.includes("membershipEmailContext")) {
      return { data: { shop: { name: "USSEA", contactEmail: null }, customer: { firstName: "Ana", defaultEmailAddress: { emailAddress: "ana@example.com" } } } };
    }
    if (query.includes("subscriptionBillingCycles")) return { data: { subscriptionBillingCycles: { nodes: [] } } };
    if (query.includes("membershipContractLines")) return { data: { subscriptionContract: { lines: { nodes: [] } } } };
    return { data: { tagsAdd: { userErrors: [] }, tagsRemove: { userErrors: [] }, credentialTypes: [] } };
  });
}

beforeEach(async () => {
  sent.length = 0;
  for (const table of ["contractImport", "emailLog", "membership", "membershipPlan"] as const) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma[table] as any).deleteMany();
  }
  const plan = await prisma.membershipPlan.create({
    data: { shop: SHOP, name: "Basic", sellingPlanId: setup.sellingPlanId, tag: "ussea-basic" },
  });
  setup.planId = plan.id;
});

describe("importRow", () => {
  it("creates the contract on the saved card at the renewal price, once", async () => {
    const { admin, calls } = shopify();
    expect(await importRow(admin, SHOP, "appstle", row, setup)).toEqual({ imported: true, contractId: CONTRACT });

    const create = calls.find((c) => c.query.includes("importContract("))!;
    expect(create.variables.input).toMatchObject({
      customerId: ANA,
      nextBillingDate: "2027-01-15",
      contract: { paymentMethodId: "gid://shopify/CustomerPaymentMethod/c1", billingPolicy: { interval: "YEAR", intervalCount: 1 } },
      lines: [
        {
          line: {
            currentPrice: "25.00",
            pricingPolicy: {
              basePrice: "25.00",
              cycleDiscounts: [{ afterCycle: 1, adjustmentType: "PRICE", adjustmentValue: { fixedValue: "25.00" }, computedPrice: "25.00" }],
            },
          },
        },
      ],
    });
    expect(await prisma.membership.findFirstOrThrow({ where: { contractId: CONTRACT } })).toMatchObject({
      createdAt: new Date("2025-01-15T12:00:00Z"),
      lastPaidAt: new Date("2026-01-15T12:00:00Z"),
    });
    expect(await prisma.contractImport.findFirst()).toMatchObject({ status: "DONE", contractId: CONTRACT });

    expect(await importRow(admin, SHOP, "appstle", row, setup)).toEqual({ imported: false, reason: "already imported" });
    expect(calls.filter((c) => c.query.includes("importContract("))).toHaveLength(1);
  });

  it("anchors billing to their renewal day", async () => {
    const { admin, calls } = shopify();
    await importRow(admin, SHOP, "appstle", row, setup);
    expect(calls.find((c) => c.query.includes("importContract("))!.variables.input).toMatchObject({
      contract: {
        billingPolicy: { interval: "YEAR", intervalCount: 1, anchors: [{ type: "YEARDAY", month: 1, day: 15 }] },
        deliveryPolicy: { anchors: [{ type: "YEARDAY", month: 1, day: 15 }] },
        deliveryPrice: "0.00",
      },
    });
  });

  it("takes the contract back if Shopify would bill on another day, without touching tags", async () => {
    const { admin, calls } = shopify({ firstBilling: "2027-11-17" });
    expect(await importRow(admin, SHOP, "appstle", row, setup)).toEqual({
      imported: false,
      reason: "Shopify would bill on 2027-11-17 instead of 2027-01-15; nothing was kept",
    });
    expect(calls.some((c) => c.query.includes("importContractCancel"))).toBe(true);
    expect(calls.some((c) => c.query.includes("membershipTagsRemove"))).toBe(false);
    expect(await prisma.contractImport.findFirst()).toMatchObject({ status: "FAILED", contractId: CONTRACT });
  });

  it("charges the card the file names, if it is still saved", async () => {
    const cards = [
      { id: "gid://shopify/CustomerPaymentMethod/c1", revokedAt: null },
      { id: "gid://shopify/CustomerPaymentMethod/c2", revokedAt: null },
    ];
    const named = shopify({ cards });
    await importRow(named.admin, SHOP, "appstle", { ...row, paymentMethodId: "gid://shopify/CustomerPaymentMethod/c2" }, setup);
    expect(named.calls.find((c) => c.query.includes("importContract("))!.variables.input).toMatchObject({
      contract: { paymentMethodId: "gid://shopify/CustomerPaymentMethod/c2" },
    });
  });

  it("uses the file's price when it has one", async () => {
    const { admin, calls } = shopify();
    await importRow(admin, SHOP, "appstle", { ...row, price: "20.00" }, setup);
    const create = calls.find((c) => c.query.includes("importContract("))!;
    expect(create.variables.input).toMatchObject({ lines: [{ line: { currentPrice: "20.00" } }] });
  });

  it("imports a free renewal at 0, not at the plan's price", async () => {
    const { admin, calls } = shopify();
    await importRow(admin, SHOP, "appstle", { ...row, price: "0.00" }, setup);
    const create = calls.find((c) => c.query.includes("importContract("))!;
    expect(create.variables.input).toMatchObject({
      lines: [{ line: { currentPrice: "0.00", pricingPolicy: { basePrice: "0.00" } } }],
    });
  });

  it("sends no welcome email to an imported member", async () => {
    const { admin } = shopify();
    await importRow(admin, SHOP, "appstle", row, setup);
    const membership = await prisma.membership.findFirstOrThrow();
    expect(await notifyWelcome(admin, membership.id)).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("sends no email of a kind listed in EMAILS_OFF", async () => {
    const { admin } = shopify();
    const m = await prisma.membership.create({
      data: { shop: SHOP, contractId: "gid://shopify/SubscriptionContract/1", customerId: ANA, planId: setup.planId, contractStatus: "ACTIVE", status: "ACTIVE" },
    });
    process.env.EMAILS_OFF = "welcome, LAPSED";
    expect(await notifyWelcome(admin, m.id)).toBe(false);
    delete process.env.EMAILS_OFF;
    expect(await notifyWelcome(admin, m.id)).toBe(true);
  });

  it("holds every email while EMAILS_OFF is ALL, and sends it once lifted", async () => {
    const { admin } = shopify();
    const m = await prisma.membership.create({
      data: { shop: SHOP, contractId: "gid://shopify/SubscriptionContract/1", customerId: ANA, planId: setup.planId, contractStatus: "ACTIVE", status: "ACTIVE" },
    });
    process.env.EMAILS_OFF = "all";
    expect(await notifyWelcome(admin, m.id)).toBe(false);
    expect(await sendTestEmail(admin, SHOP, "Basic", { subject: "Hi", html: "<p>Hi</p>" })).toMatchObject({ ok: false });
    delete process.env.EMAILS_OFF;
    expect(sent).toHaveLength(0);
    expect(await notifyWelcome(admin, m.id)).toBe(true);
  });

  it("skips a customer without a saved card", async () => {
    const { admin, calls } = shopify({ cards: [] });
    expect(await importRow(admin, SHOP, "appstle", row, setup)).toEqual({ imported: false, reason: "customer has no saved card in Shopify" });
    expect(calls.some((c) => c.query.includes("importContract("))).toBe(false);
    expect(await prisma.contractImport.findFirst()).toMatchObject({ status: "FAILED" });
  });

  it("records Shopify's refusal and allows a retry", async () => {
    expect(await importRow(shopify({ refuse: true }).admin, SHOP, "appstle", row, setup)).toEqual({
      imported: false,
      reason: "Shopify refused the contract: Payment method is invalid",
    });
    expect(await importRow(shopify().admin, SHOP, "appstle", row, setup)).toMatchObject({ imported: true });
  });
});

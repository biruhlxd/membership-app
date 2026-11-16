import { fakeAdmin, testPrisma as prisma } from "../test/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Never send real email from tests.
const sent = vi.hoisted(() => [] as { to: string; subject: string; html?: string; from: { name: string } }[]);
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: async (m: (typeof sent)[number]) => void sent.push(m) }) },
}));
import { lookFor, notifyWelcome, saveLook, saveTemplate, sendTestEmail, templateFor } from "./emails.server";
import { DEFAULT_LOOK } from "./emailTemplates";

const SHOP = "test-shop.myshopify.com";
const ANA = "gid://shopify/Customer/77";
process.env.SMTP_HOST = "smtp.test.invalid";
process.env.EMAIL_FROM = "membership@test.invalid";

const shopify = () =>
  fakeAdmin((query) =>
    query.includes("membershipEmailContext") || query.includes("membershipShopForEmails")
      ? {
          data: {
            shop: { name: "USSEA", contactEmail: "staff@ussea.test", primaryDomain: { url: "https://ussea.us" }, customerAccountsV2: null },
            customer: { firstName: "Ana", defaultEmailAddress: { emailAddress: "ana@example.com" } },
          },
        }
      : { data: {} },
  );

let planId = "";
let membershipId = "";

beforeEach(async () => {
  sent.length = 0;
  delete process.env.EMAILS_OFF;
  for (const table of ["emailLog", "emailTemplate", "emailLook", "membership", "membershipPlan"] as const) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma[table] as any).deleteMany();
  }
  const plan = await prisma.membershipPlan.create({
    data: { shop: SHOP, name: "Instructor Certification", sellingPlanId: "gid://shopify/SellingPlan/1", tag: "ussea-instructor" },
  });
  planId = plan.id;
  membershipId = (
    await prisma.membership.create({
      data: { shop: SHOP, contractId: "gid://shopify/SubscriptionContract/1", customerId: ANA, planId, contractStatus: "ACTIVE", status: "ACTIVE" },
    })
  ).id;
});

describe("welcome email per plan", () => {
  it("uses the plan's own wording and the shop's look", async () => {
    await saveTemplate(SHOP, "WELCOME", planId, {
      enabled: true,
      subject: "Welcome to USSEA — Your instructor certification is ready",
      html: '<h1>Your instructor certification awaits.</h1><p>Hi {{first_name}},</p><a href="{{sign_in_url}}">Start Your Course</a>',
    });
    expect(await saveLook(SHOP, { ...DEFAULT_LOOK, senderName: "USSEA", accentColor: "#C8102E", signInPath: "/pages/member-portal" })).toBeNull();

    expect(await notifyWelcome(shopify().admin, membershipId)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "ana@example.com", subject: "Welcome to USSEA — Your instructor certification is ready" });
    expect(sent[0].from.name).toBe("USSEA");
    expect(sent[0].html).toContain("Hi Ana,");
    expect(sent[0].html).toContain(
      "https://ussea.us/customer_authentication/login?return_to=%2Fpages%2Fmember-portal&amp;login_hint=ana%40example.com&amp;login_hint_mode=submit",
    );
    expect(sent[0].html).toContain("border-top:4px solid #C8102E");
  });

  it("sends nothing when the plan's welcome is switched off", async () => {
    const current = await templateFor(SHOP, "WELCOME", planId);
    expect(current.custom).toBe(false);
    await saveTemplate(SHOP, "WELCOME", planId, { ...current, enabled: false });
    expect(await notifyWelcome(shopify().admin, membershipId)).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("falls back to the default wording", async () => {
    expect(await notifyWelcome(shopify().admin, membershipId)).toBe(true);
    expect(sent[0].subject).toBe("Welcome to your Instructor Certification");
  });

  it("refuses an unsafe look", async () => {
    expect(await saveLook(SHOP, { ...DEFAULT_LOOK, logoUrl: "http://x.com/l.png" })).toMatch(/https/);
    expect(await saveLook(SHOP, { ...DEFAULT_LOOK, signInPath: "https://evil.example" })).toMatch(/path/);
    expect(await lookFor(SHOP)).toEqual(DEFAULT_LOOK);
  });

  it("diverts every email to EMAIL_DIVERT_TO on a test server", async () => {
    process.env.EMAIL_DIVERT_TO = "biruh@test.invalid";
    try {
      expect(await notifyWelcome(shopify().admin, membershipId)).toBe(true);
    } finally {
      delete process.env.EMAIL_DIVERT_TO;
    }
    expect(sent[0].to).toBe("biruh@test.invalid");
    expect(sent[0].subject).toBe("[to ana@example.com] Welcome to your Instructor Certification");
  });

  it("sends a test to the store's contact email", async () => {
    const result = await sendTestEmail(shopify().admin, SHOP, "Coach", { subject: "Hi {{first_name}}", html: "<p>{{plan_name}}</p>" });
    expect(result).toEqual({ ok: true, to: "staff@ussea.test" });
    expect(sent[0].subject).toBe("[Test] Hi Ana");
    expect(sent[0].html).toContain("Coach");
  });
});

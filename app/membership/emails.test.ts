import { describe, expect, it } from "vitest";
import {
  emailKey,
  lapsedEmail,
  paymentFailedEmail,
  reminderDue,
  renewalReminderEmail,
  seatInviteEmail,
  credentialExpiringEmail,
  credentialExpiryDue,
  credentialIssuedEmail,
  credentialPendingEmail,
  welcomeEmail,
} from "./emails";

const now = new Date("2027-10-24T12:00:00Z");

describe("reminderDue", () => {
  it("is due within seven days before the renewal", () => {
    expect(reminderDue(new Date("2027-10-31T12:00:00Z"), now)).toBe(true);
    expect(reminderDue(new Date("2027-10-25T12:00:00Z"), now)).toBe(true);
  });

  it("waits when the renewal is further away", () => {
    expect(reminderDue(new Date("2027-11-01T12:00:00Z"), now)).toBe(false);
  });

  it("is not due once the renewal date has passed, or with no renewal", () => {
    expect(reminderDue(new Date("2027-10-24T11:00:00Z"), now)).toBe(false);
    expect(reminderDue(null, now)).toBe(false);
  });
});

describe("emailKey", () => {
  it("gives one reminder per renewal date", () => {
    expect(emailKey("RENEWAL_REMINDER", { renewalAt: new Date("2027-10-31T16:00:00Z") })).toBe(
      "renewal-2027-10-31",
    );
  });

  it("gives one failure notice per failed attempt, and one lapse notice", () => {
    expect(emailKey("PAYMENT_FAILED", { failedAttempts: 2 })).toBe("failed-2");
    expect(emailKey("LAPSED")).toBe("lapsed");
  });
});

describe("email content", () => {
  it("names the plan, date and amount in the reminder", () => {
    const email = renewalReminderEmail({
      shopName: "USSEA",
      firstName: "Biruh",
      planName: "Coach membership",
      renewalDate: "October 31, 2027",
      amount: "$90.00",
    });
    expect(email.subject).toBe("Your Coach membership renews on October 31, 2027");
    expect(email.text).toContain("Hi Biruh,");
    expect(email.text).toContain("renews on October 31, 2027 for $90.00");
  });

  it("says when the next try is, or that it was the last", () => {
    const base = { shopName: "USSEA", firstName: null, planName: "Coach membership" };
    expect(paymentFailedEmail({ ...base, retryDate: "November 1, 2027" }).text).toContain(
      "We'll try again on November 1, 2027",
    );
    expect(paymentFailedEmail({ ...base, retryDate: null }).text).toContain("our last try");
    expect(paymentFailedEmail({ ...base, retryDate: null }).text).toContain("Hello,");
  });

  it("tells a lapsed member how to come back", () => {
    expect(
      lapsedEmail({ shopName: "USSEA", firstName: null, planName: "Coach membership" }).text,
    ).toContain("buy the membership in our store");
  });
});

describe("seat invitations", () => {
  it("gives one invitation email per seat", () => {
    expect(emailKey("SEAT_INVITE", { seatId: "seat1" })).toBe("invite-seat1");
  });

  it("says who invited them, to which seat, and how to accept", () => {
    const email = seatInviteEmail({ shopName: "USSEA", inviterName: "Addis Club", seatName: "Coach" });
    expect(email.subject).toBe("Addis Club invited you to a Coach membership seat");
    expect(email.text).toContain("open the Membership page and choose Accept");
  });
});

describe("credential emails", () => {
  const now = new Date("2026-11-06T00:00:00Z");

  it("are due 30 days before expiry, not after it, and never for credentials that don't expire", () => {
    expect(credentialExpiryDue(new Date("2026-12-01T00:00:00Z"), now)).toBe(true);
    expect(credentialExpiryDue(new Date("2027-01-01T00:00:00Z"), now)).toBe(false);
    expect(credentialExpiryDue(new Date("2026-11-01T00:00:00Z"), now)).toBe(false);
    expect(credentialExpiryDue(null, now)).toBe(false);
  });

  it("say what the member needs to know", () => {
    const issued = credentialIssuedEmail({
      shopName: "USSEA",
      firstName: "Ana",
      typeName: "Coach Level 1",
      number: "COACH1-2026-00001",
      expiresAt: new Date("2028-01-15T00:00:00Z"),
      verifyUrl: "https://app.example.com/verify/abc",
    });
    expect(issued.subject).toBe("Your Coach Level 1 credential");
    expect(issued.text).toContain("COACH1-2026-00001");
    expect(issued.text).toContain("January 15, 2028");
    expect(issued.text).toContain("https://app.example.com/verify/abc");
    expect(credentialPendingEmail({ shopName: "USSEA", firstName: null, typeName: "Coach Level 1" }).text).toMatch(/^Hello,/);
    expect(
      credentialExpiringEmail({ shopName: "USSEA", firstName: "Ana", typeName: "Coach Level 1", number: "N", expiresAt: new Date("2026-12-01T00:00:00Z") }).subject,
    ).toBe("Your Coach Level 1 credential expires on December 1, 2026");
  });
});

describe("welcomeEmail", () => {
  const base = { shopName: "USSEA", firstName: "Ana", planName: "Coach membership" };

  it("says when it renews and links the Membership page", () => {
    const email = welcomeEmail({
      ...base,
      renewalDate: "November 6, 2027",
      amount: "$90.00",
      accountUrl: "https://shopify.com/1/account",
    });
    expect(email.subject).toBe("Welcome to your Coach membership");
    expect(email.text).toContain("renews automatically on November 6, 2027 for $90.00");
    expect(email.text).toContain("Membership page in your account: https://shopify.com/1/account");
    expect(emailKey("WELCOME")).toBe("welcome");
  });

  it("still makes sense without a date, amount or link", () => {
    const email = welcomeEmail({ ...base, renewalDate: null, amount: null, accountUrl: null });
    expect(email.text).toContain("It renews automatically, and we'll remind you a week before.");
    expect(email.text).toContain("go to the Membership page in your account.");
  });
});

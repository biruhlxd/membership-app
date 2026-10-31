import { describe, expect, it } from "vitest";
import {
  emailKey,
  lapsedEmail,
  paymentFailedEmail,
  reminderDue,
  renewalReminderEmail,
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

// Credentials: rules only, no Shopify calls and no database.
//
// A credential type (for example "Coach Level 1", code COACH1) is earned when
// a customer meets its requirements: customer tags (Moodle Bridge tags a
// customer "completed:<course>" when they finish a course, so a completion
// counts) and/or an active membership plan. Types can need an approver.
// Issued credentials get a number (COACH1-2026-00001), may expire, and while
// active put the tag "credential:<code>" on the customer. A type can hold or
// flag membership renewals when the member's credential has lapsed.

export type Requirement = { kind: "tag"; tag: string } | { kind: "plan"; planId: string };
export type RenewalRule = "none" | "flag" | "block";
export const RENEWAL_RULES: RenewalRule[] = ["none", "flag", "block"];

export interface CredentialTypeInput {
  name: string;
  code: string;
  validityMonths: number;
  requirements: Requirement[];
  needsApproval: boolean;
  renewalRule: RenewalRule;
  /** Plans whose renewals check this credential (renewalRule flag/block). */
  renewalPlanIds: string[];
}

const normalizeTag = (tag: string) => tag.trim().toLowerCase();

/** Read and check the credential type form. */
export function parseTypeForm(
  form: Record<string, string | string[] | undefined>,
): { ok: true; value: CredentialTypeInput } | { ok: false; errors: Record<string, string> } {
  const text = (key: string) => (typeof form[key] === "string" ? (form[key] as string).trim() : "");
  const list = (key: string) => (Array.isArray(form[key]) ? (form[key] as string[]) : form[key] ? [form[key] as string] : []);
  const errors: Record<string, string> = {};

  const name = text("name");
  if (!name) errors.name = "Enter a name.";
  const code = text("code").toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(code)) errors.code = "Use 2 to 12 letters and numbers.";
  const validityMonths = Number(text("validityMonths") || "0");
  if (!Number.isInteger(validityMonths) || validityMonths < 0 || validityMonths > 120) {
    errors.validityMonths = "Enter 0 (never expires) to 120 months.";
  }
  const tags = text("tags")
    .split(",")
    .map(normalizeTag)
    .filter(Boolean);
  const requirements: Requirement[] = [
    ...[...new Set(tags)].map((tag) => ({ kind: "tag" as const, tag })),
    ...[...new Set(list("planIds"))].map((planId) => ({ kind: "plan" as const, planId })),
  ];
  if (!requirements.length) errors.requirements = "Add at least one tag or plan the customer must have.";
  const renewalRule = (text("renewalRule") || "none") as RenewalRule;
  if (!RENEWAL_RULES.includes(renewalRule)) errors.renewalRule = "Choose what happens at renewal.";
  const renewalPlanIds = [...new Set(list("renewalPlanIds"))];
  if (renewalRule !== "none" && !renewalPlanIds.length) {
    errors.renewalPlanIds = "Choose the plans whose renewals check this credential.";
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      code,
      validityMonths,
      requirements,
      needsApproval: form.needsApproval === "on" || form.needsApproval === "true",
      renewalRule,
      renewalPlanIds: renewalRule === "none" ? [] : renewalPlanIds,
    },
  };
}

/** Whether a customer with these tags and active plans meets every requirement. */
export function requirementsMet(requirements: Requirement[], customer: { tags: string[]; planIds: string[] }): boolean {
  if (!requirements.length) return false;
  const tags = new Set(customer.tags.map(normalizeTag));
  return requirements.every((r) => (r.kind === "tag" ? tags.has(normalizeTag(r.tag)) : customer.planIds.includes(r.planId)));
}

/** COACH1-2026-00001 */
export function credentialNumber(code: string, year: number, sequence: number): string {
  return `${code}-${year}-${String(sequence).padStart(5, "0")}`;
}

/** Expiry: the same day N months later (end of month when shorter), or null for never. */
export function expiresAt(issuedAt: Date, validityMonths: number): Date | null {
  if (!validityMonths) return null;
  const d = new Date(issuedAt);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + validityMonths);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** The tag an active credential puts on the customer. */
export function credentialTag(code: string): string {
  return `credential:${code.toLowerCase()}`;
}

/** What a renewal does about one credential type. */
export function renewalDecision(rule: RenewalRule, hasActiveCredential: boolean): "charge" | "flag" | "block" {
  if (hasActiveCredential || rule === "none") return "charge";
  return rule;
}

/** The name the public verification page shows: first name and last initial. */
export function publicName(firstName: string | null | undefined, lastName: string | null | undefined): string {
  const first = (firstName ?? "").trim();
  const initial = (lastName ?? "").trim().charAt(0);
  return [first, initial ? `${initial.toUpperCase()}.` : ""].filter(Boolean).join(" ") || "Member";
}

export function requirementsToJson(requirements: Requirement[]): string {
  return JSON.stringify(requirements);
}

export function requirementsFromJson(json: string | null | undefined): Requirement[] {
  try {
    const value = JSON.parse(json ?? "[]");
    return Array.isArray(value)
      ? value.filter(
          (r): r is Requirement =>
            (r?.kind === "tag" && typeof r.tag === "string") || (r?.kind === "plan" && typeof r.planId === "string"),
        )
      : [];
  } catch {
    return [];
  }
}

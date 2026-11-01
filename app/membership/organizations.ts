// Organization plans and their seats: seat types on a plan, who can be
// invited, and which tags seats give. Pure functions: no Shopify calls, no
// database.
//
// A plan with seat types is an organization plan. Whoever buys it is the
// organization admin; they invite people by email into a seat type. An
// accepted seat gives its holder the seat type's tag while the
// organization's membership grants access, so seats pause by themselves
// when the organization's plan lapses and come back when it renews.

export interface SeatType {
  name: string;
  tag: string;
  seats: number;
}

export type SeatStatus = "INVITED" | "ACTIVE" | "ENDED";

export interface SeatTypeRow {
  name: string;
  tag: string;
  seats: string;
}

export type SeatTypesResult =
  | { ok: true; seatTypes: SeatType[] }
  | { ok: false; error: string };

const lower = (s: string) => s.trim().toLowerCase();

/**
 * The seat types from the plan form. Fully empty rows are ignored; an
 * organization plan needs at least one seat type, a plain plan none.
 */
export function parseSeatTypes(rows: SeatTypeRow[]): SeatTypesResult {
  const seatTypes: SeatType[] = [];
  for (const row of rows) {
    const name = row.name.trim();
    const tag = row.tag.trim();
    const seatsText = row.seats.trim();
    if (!name && !tag && !seatsText) continue;
    if (!name || !tag || !seatsText) {
      return { ok: false, error: "Fill in the name, tag and number of seats for each seat type." };
    }
    if (tag.includes(",")) return { ok: false, error: `The tag "${tag}" can't contain a comma.` };
    const seats = Number(seatsText);
    if (!Number.isInteger(seats) || seats < 1 || seats > 10000) {
      return { ok: false, error: `Seats for ${name} must be a whole number from 1 to 10,000.` };
    }
    if (seatTypes.some((s) => lower(s.tag) === lower(tag))) {
      return { ok: false, error: `Two seat types use the tag "${tag}".` };
    }
    seatTypes.push({ name, tag, seats });
  }
  return { ok: true, seatTypes };
}

export function seatTypesToJson(seatTypes: SeatType[]): string | null {
  return seatTypes.length > 0 ? JSON.stringify(seatTypes) : null;
}

/** The seat types stored on a plan (null or invalid means none). */
export function seatTypesFromJson(json: string | null | undefined): SeatType[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed)
      ? parsed.filter(
          (s): s is SeatType =>
            typeof s?.name === "string" && typeof s?.tag === "string" && Number.isInteger(s?.seats),
        )
      : [];
  } catch {
    return [];
  }
}

export interface SeatUsage extends SeatType {
  used: number;
  left: number;
}

/** Seats used (invited or active) and left, per seat type. */
export function seatUsage(
  seatTypes: SeatType[],
  seats: { tag: string; status: SeatStatus }[],
): SeatUsage[] {
  return seatTypes.map((type) => {
    const used = seats.filter(
      (s) => lower(s.tag) === lower(type.tag) && s.status !== "ENDED",
    ).length;
    return { ...type, used, left: Math.max(0, type.seats - used) };
  });
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type InviteCheck = { ok: true; seatType: SeatType } | { ok: false; error: string };

/** Whether the admin can invite `email` into the seat type with `tag`. */
export function checkInvite(
  seatTypes: SeatType[],
  seats: { tag: string; status: SeatStatus; email: string }[],
  email: string,
  tag: string,
): InviteCheck {
  const address = normalizeEmail(email);
  if (!EMAIL.test(address)) return { ok: false, error: "Enter a valid email address." };
  const seatType = seatTypes.find((s) => lower(s.tag) === lower(tag));
  if (!seatType) return { ok: false, error: "Choose a seat type." };
  const taken = seats.some(
    (s) => s.status !== "ENDED" && lower(s.tag) === lower(tag) && normalizeEmail(s.email) === address,
  );
  if (taken) return { ok: false, error: `${address} already has or was invited to a ${seatType.name} seat.` };
  const usage = seatUsage([seatType], seats)[0];
  if (usage.left === 0) {
    return { ok: false, error: `All ${seatType.seats} ${seatType.name} seats are used. End a seat to free one.` };
  }
  return { ok: true, seatType };
}

/**
 * Every tag the app manages in a shop: each plan's tag and each seat type's
 * tag. Only these are ever removed from a customer.
 */
export function managedTags(plans: { tag: string; seatTypes: string | null }[]): string[] {
  const tags = new Map<string, string>();
  for (const plan of plans) {
    tags.set(lower(plan.tag), plan.tag.trim());
    for (const seat of seatTypesFromJson(plan.seatTypes)) tags.set(lower(seat.tag), seat.tag.trim());
  }
  return [...tags.values()];
}

/** The seat type rows of the plan form (fields seatName0..2, seatTag0..2, seatCount0..2). */
export function seatRowsFromForm(field: (key: string) => string): SeatTypeRow[] {
  return [0, 1, 2].map((i) => ({
    name: field(`seatName${i}`),
    tag: field(`seatTag${i}`),
    seats: field(`seatCount${i}`),
  }));
}

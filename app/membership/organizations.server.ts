// Organizations against the database and Shopify: what a customer sees in
// the member portal, and the seat actions. Every action checks who is
// asking: `customerId` comes from Shopify's session token, never from the
// request body.
//
// The query is validated against the 2026-10 Admin API schema.
import prisma from "../db.server";
import { syncTagsForCustomer } from "./contracts.server";
import { notifySeatInvite } from "./emails.server";
import {
  checkInvite,
  normalizeEmail,
  seatTypesFromJson,
  seatUsage,
  type SeatStatus,
} from "./organizations";
import type { Admin } from "./plans.server";
import { grantsAccess, type MembershipStatus } from "./status";

const CUSTOMER_EMAIL = `#graphql
  query membershipCustomerEmail($id: ID!) {
    customer(id: $id) {
      defaultEmailAddress {
        emailAddress
      }
    }
  }`;

async function emailOf(admin: Admin, customerId: string): Promise<string | null> {
  const body = await (await admin.graphql(CUSTOMER_EMAIL, { variables: { id: customerId } })).json();
  const email: string | undefined = body.data?.customer?.defaultEmailAddress?.emailAddress;
  return email ? normalizeEmail(email) : null;
}

/** An organization with its plan, status and seat types. */
async function organizationDetails(organizationId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: { seats: { orderBy: { invitedAt: "asc" } } },
  });
  if (!organization) return null;
  const membership = await prisma.membership.findUnique({
    where: { id: organization.membershipId },
    include: { plan: { select: { name: true, seatTypes: true } } },
  });
  if (!membership) return null;
  const seatTypes = seatTypesFromJson(membership.plan.seatTypes);
  const seatName = (tag: string) =>
    seatTypes.find((s) => s.tag.toLowerCase() === tag.toLowerCase())?.name ?? tag;
  return { organization, membership, seatTypes, seatName };
}

export type PortalState = Awaited<ReturnType<typeof portalState>>;

/** Everything about organizations the member portal shows this customer. */
export async function portalState(admin: Admin, shop: string, customerId: string) {
  const email = await emailOf(admin, customerId);

  const adminOf = await prisma.organization.findMany({
    where: { shop, adminCustomerId: customerId },
    select: { id: true },
  });
  const organizations = [];
  for (const { id } of adminOf) {
    const details = await organizationDetails(id);
    if (!details) continue;
    const { organization, membership, seatTypes, seatName } = details;
    organizations.push({
      id: organization.id,
      planName: membership.plan.name,
      active: grantsAccess(membership.status as MembershipStatus),
      seatTypes: seatUsage(
        seatTypes,
        organization.seats.map((s) => ({ tag: s.tag, status: s.status as SeatStatus })),
      ),
      seats: organization.seats
        .filter((s) => s.status !== "ENDED")
        .map((s) => ({ id: s.id, email: s.email, seatName: seatName(s.tag), status: s.status })),
    });
  }

  const invited = email
    ? await prisma.seat.findMany({
        where: { email, status: "INVITED", organization: { shop } },
        select: { id: true, tag: true, organizationId: true },
      })
    : [];
  const held = await prisma.seat.findMany({
    where: { customerId, status: "ACTIVE", organization: { shop } },
    select: { id: true, tag: true, organizationId: true },
  });

  const describe = async (seat: { id: string; tag: string; organizationId: string }) => {
    const details = await organizationDetails(seat.organizationId);
    return details
      ? {
          id: seat.id,
          planName: details.membership.plan.name,
          seatName: details.seatName(seat.tag),
          active: grantsAccess(details.membership.status as MembershipStatus),
        }
      : null;
  };
  const invitations = (await Promise.all(invited.map(describe))).filter(Boolean);
  const seats = (await Promise.all(held.map(describe))).filter(Boolean);

  return { email, organizations, invitations, seats };
}

type Result = { ok: true; message: string } | { ok: false; error: string };

/** The organization admin invites `email` into a seat type. */
export async function inviteToSeat(
  admin: Admin,
  shop: string,
  customerId: string,
  input: { organizationId: string; email: string; tag: string },
): Promise<Result> {
  const details = await organizationDetails(input.organizationId);
  if (!details || details.organization.shop !== shop) return { ok: false, error: "Organization not found." };
  if (details.organization.adminCustomerId !== customerId) {
    return { ok: false, error: "Only the organization's admin can invite people." };
  }
  if (!grantsAccess(details.membership.status as MembershipStatus)) {
    return { ok: false, error: "The organization's membership isn't active, so seats can't be given out." };
  }
  const check = checkInvite(
    details.seatTypes,
    details.organization.seats.map((s) => ({ tag: s.tag, status: s.status as SeatStatus, email: s.email })),
    input.email,
    input.tag,
  );
  if (!check.ok) return { ok: false, error: check.error };

  const seat = await prisma.seat.create({
    data: {
      organizationId: details.organization.id,
      tag: check.seatType.tag,
      email: normalizeEmail(input.email),
      status: "INVITED",
    },
  });
  try {
    await notifySeatInvite(
      admin,
      { id: seat.id, email: seat.email, seatName: check.seatType.name },
      details.organization,
    );
  } catch (error) {
    console.error(`seat ${seat.id}: invitation email not sent:`, error);
  }
  return { ok: true, message: `Invited ${seat.email} to a ${check.seatType.name} seat.` };
}

/** The organization admin ends a seat (or withdraws an invitation). */
export async function endSeat(
  admin: Admin,
  shop: string,
  customerId: string,
  seatId: string,
): Promise<Result> {
  const seat = await prisma.seat.findUnique({ where: { id: seatId }, include: { organization: true } });
  if (!seat || seat.organization.shop !== shop || seat.status === "ENDED") {
    return { ok: false, error: "Seat not found." };
  }
  if (seat.organization.adminCustomerId !== customerId) {
    return { ok: false, error: "Only the organization's admin can end seats." };
  }
  await prisma.seat.update({ where: { id: seat.id }, data: { status: "ENDED", endedAt: new Date() } });
  if (seat.customerId) await syncTagsForCustomer(admin, shop, seat.customerId);
  return { ok: true, message: `${seat.email}'s seat has ended.` };
}

/** The invited person accepts or declines; only the matching email can. */
export async function answerInvitation(
  admin: Admin,
  shop: string,
  customerId: string,
  seatId: string,
  accept: boolean,
): Promise<Result> {
  const seat = await prisma.seat.findUnique({ where: { id: seatId }, include: { organization: true } });
  if (!seat || seat.organization.shop !== shop || seat.status !== "INVITED") {
    return { ok: false, error: "This invitation is no longer open." };
  }
  const email = await emailOf(admin, customerId);
  if (!email || email !== seat.email) {
    return { ok: false, error: "This invitation was sent to a different email address." };
  }
  if (!accept) {
    await prisma.seat.update({ where: { id: seat.id }, data: { status: "ENDED", endedAt: new Date() } });
    return { ok: true, message: "Invitation declined." };
  }
  await prisma.seat.update({
    where: { id: seat.id },
    data: { status: "ACTIVE", customerId, acceptedAt: new Date() },
  });
  await syncTagsForCustomer(admin, shop, customerId);
  return { ok: true, message: "Seat accepted. You now have member access." };
}

// Moving subscribers in from another subscription app: one Shopify contract
// per checked row (see import.ts), on the customer's saved card, with the
// next billing date and renewal price they had. Nothing is charged now.
//
// All operations are validated against the 2026-10 Admin API schema. They
// need read_customers, read_customer_payment_methods and
// write_own_subscription_contracts.
import prisma from "../db.server";
import { syncContract } from "./contracts.server";
import { refreshSchedule } from "./renewals.server";
import { evaluateCustomer } from "./credentials.server";
import { getPlan, type Admin } from "./plans.server";
import type { ImportRow } from "./import";

const CUSTOMER_BY_EMAIL = `#graphql
  query importCustomer($email: String!) {
    customerByIdentifier(identifier: { emailAddress: $email }) {
      id
      paymentMethods(first: 10, showRevoked: false) {
        nodes {
          id
          revokedAt
        }
      }
    }
  }`;

const CUSTOMER_BY_ID = `#graphql
  query importCustomerById($id: ID!) {
    customer(id: $id) {
      id
      paymentMethods(first: 10, showRevoked: false) {
        nodes {
          id
          revokedAt
        }
      }
    }
  }`;

const PLAN_SETUP = `#graphql
  query importPlanTerms($id: ID!) {
    sellingPlanGroup(id: $id) {
      sellingPlans(first: 1) {
        nodes {
          id
          name
        }
      }
      productVariants(first: 1) {
        nodes {
          id
        }
      }
      products(first: 1) {
        nodes {
          variants(first: 1) {
            nodes {
              id
            }
          }
        }
      }
    }
    shop {
      currencyCode
    }
  }`;

const CREATE_CONTRACT = `#graphql
  mutation importContract($input: SubscriptionContractAtomicCreateInput!) {
    subscriptionContractAtomicCreate(input: $input) {
      contract {
        id
      }
      userErrors {
        field
        message
      }
    }
  }`;

/** What every contract of one plan is made of. */
export interface PlanSetup {
  planId: string;
  sellingPlanId: string;
  sellingPlanName: string;
  variantId: string;
  currencyCode: string;
  interval: "MONTH" | "YEAR";
  intervalCount: number;
  renewalPrice: string;
}

async function gql<T>(
  admin: Admin,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const body = await (await admin.graphql(query, { variables })).json();
  return body.data as T;
}

/** Read a plan's terms and product from Shopify; null when it can't be used. */
export async function planSetup(admin: Admin, shop: string, planId: string): Promise<PlanSetup | null> {
  const plan = await getPlan(admin, shop, planId);
  const groupId = plan
    ? (await prisma.membershipPlan.findUnique({ where: { id: planId }, select: { sellingPlanGroupId: true } }))
        ?.sellingPlanGroupId
    : null;
  if (!plan?.terms || !groupId) return null;
  const data = await gql<{
    sellingPlanGroup: {
      sellingPlans: { nodes: { id: string; name: string }[] };
      productVariants: { nodes: { id: string }[] };
      products: { nodes: { variants: { nodes: { id: string }[] } }[] };
    } | null;
    shop: { currencyCode: string };
  }>(admin, PLAN_SETUP, { id: groupId });
  const group = data.sellingPlanGroup;
  const sellingPlan = group?.sellingPlans.nodes[0];
  // A variant-level plan names its variant; otherwise the product's first.
  const variantId =
    group?.productVariants.nodes[0]?.id ?? group?.products.nodes[0]?.variants.nodes[0]?.id;
  if (!sellingPlan || !variantId) return null;
  return {
    planId,
    sellingPlanId: sellingPlan.id,
    sellingPlanName: sellingPlan.name,
    variantId,
    currencyCode: data.shop.currencyCode,
    interval: plan.terms.interval,
    intervalCount: plan.terms.intervalCount,
    renewalPrice: plan.terms.renewalPrice.toFixed(2),
  };
}

export type ImportResult =
  | { imported: true; contractId: string }
  | { imported: false; reason: string };

/**
 * Create one row's contract. Recorded per source contract before Shopify is
 * called, so a second run never makes a second contract, and the welcome
 * email (sent from the contract webhook) knows to stay quiet.
 */
export async function importRow(
  admin: Admin,
  shop: string,
  source: string,
  row: ImportRow,
  setup: PlanSetup,
): Promise<ImportResult> {
  const where = { shop_source_sourceId: { shop, source, sourceId: row.sourceId } };
  const previous = await prisma.contractImport.findUnique({ where });
  if (previous?.status === "DONE") return { imported: false, reason: "already imported" };
  if (previous?.status === "PENDING") {
    // A run that stopped half way: Shopify may have the contract already.
    return { imported: false, reason: "an earlier run stopped part way; check this customer's subscriptions in Shopify" };
  }

  type Customer = { id: string; paymentMethods: { nodes: { id: string; revokedAt: string | null }[] } } | null;
  const customer = row.customerId
    ? (await gql<{ customer: Customer }>(admin, CUSTOMER_BY_ID, { id: row.customerId })).customer
    : (await gql<{ customerByIdentifier: Customer }>(admin, CUSTOMER_BY_EMAIL, { email: row.email }))
        .customerByIdentifier;

  const fail = async (reason: string, customerId: string | null = customer?.id ?? null) => {
    await prisma.contractImport.upsert({
      where,
      create: { shop, source, sourceId: row.sourceId, customerId, status: "FAILED", error: reason },
      update: { customerId, status: "FAILED", error: reason },
    });
    return { imported: false as const, reason };
  };
  if (!customer) return fail("customer not found in Shopify");
  // The card the old contract charges, if the file names it and it is still
  // saved; else the customer's first saved card.
  const cards = customer.paymentMethods.nodes.filter((p) => !p.revokedAt);
  const paymentMethod = cards.find((p) => p.id === row.paymentMethodId) ?? cards[0];
  if (!paymentMethod) return fail("customer has no saved card in Shopify");
  const member = await prisma.membership.findFirst({
    where: { shop, customerId: customer.id, planId: setup.planId, contractStatus: "ACTIVE" },
    select: { id: true },
  });
  if (member) return fail("already has an active membership on this plan");

  await prisma.contractImport.upsert({
    where,
    create: { shop, source, sourceId: row.sourceId, customerId: customer.id, status: "PENDING" },
    update: { customerId: customer.id, status: "PENDING", error: null },
  });

  const price = row.price ?? setup.renewalPrice;
  const cadence = { interval: setup.interval, intervalCount: setup.intervalCount };
  const { subscriptionContractAtomicCreate: created } = await gql<{
    subscriptionContractAtomicCreate: {
      contract: { id: string } | null;
      userErrors: { message: string }[];
    } | null;
  }>(admin, CREATE_CONTRACT, {
    input: {
      customerId: customer.id,
      nextBillingDate: row.nextBillingDate,
      currencyCode: setup.currencyCode,
      contract: {
        status: "ACTIVE",
        paymentMethodId: paymentMethod.id,
        billingPolicy: cadence,
        deliveryPolicy: cadence,
      },
      lines: [
        {
          line: {
            productVariantId: setup.variantId,
            quantity: 1,
            sellingPlanId: setup.sellingPlanId,
            sellingPlanName: setup.sellingPlanName,
            // Every cycle of a moved member is a renewal: one price, no
            // joining price. Shopify wants at least one cycle step, so the
            // renewal price "after cycle 1" too (the shape the plans have).
            currentPrice: price,
            pricingPolicy: {
              basePrice: price,
              cycleDiscounts: [
                { afterCycle: 1, adjustmentType: "PRICE", adjustmentValue: { fixedValue: price }, computedPrice: price },
              ],
            },
          },
        },
      ],
    },
  });
  const contractId = created?.contract?.id;
  if (!contractId) {
    const errors = created?.userErrors.map((e) => e.message).join(" ") || "no response from Shopify";
    return fail(`Shopify refused the contract: ${errors}`);
  }
  await prisma.contractImport.update({ where, data: { contractId, status: "DONE", error: null } });

  // The contract webhook does the same; doing it here shows the member at once.
  const synced = await syncContract(admin, shop, contractId);
  if (synced.synced) {
    const membership = await prisma.membership.findUnique({
      where: { shop_contractId: { shop, contractId } },
      select: { id: true },
    });
    if (membership) await refreshSchedule(admin, membership.id);
    await evaluateCustomer(admin, shop, customer.id).catch((error) =>
      console.error(`credentials for ${customer.id} on ${shop} failed:`, error),
    );
  }
  return { imported: true, contractId };
}

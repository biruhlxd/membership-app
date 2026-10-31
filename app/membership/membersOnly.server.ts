// Members-only products against Shopify: the checkout validation that runs
// the members-only function, its settings, and the product tags.
//
// All operations are validated against the 2026-10 Admin API schema.
import prisma from "../db.server";
import type { Admin } from "./plans.server";
import { MEMBERS_ONLY_TAG, membersOnlyConfig } from "./membersOnly";

const FUNCTION_HANDLE = "members-only";
const CONFIG = { namespace: "$app:membership", key: "members-only" };

const VALIDATIONS = `#graphql
  query membershipValidations {
    validations(first: 50) {
      nodes {
        id
        enabled
        shopifyFunction {
          handle
        }
      }
    }
  }`;

const VALIDATION_CREATE = `#graphql
  mutation membershipValidationCreate($validation: ValidationCreateInput!) {
    validationCreate(validation: $validation) {
      validation {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }`;

const METAFIELDS_SET = `#graphql
  mutation membershipMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }`;

const PRODUCTS = `#graphql
  query membershipMembersOnlyProducts {
    products(first: 100, query: "tag:members-only") {
      nodes {
        id
        title
        status
      }
    }
  }`;

const TAGS_ADD = `#graphql
  mutation membershipProductTagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      userErrors {
        field
        message
      }
    }
  }`;

const TAGS_REMOVE = `#graphql
  mutation membershipProductTagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      userErrors {
        field
        message
      }
    }
  }`;

async function call(admin: Admin, query: string, variables?: Record<string, unknown>) {
  const body = await (await admin.graphql(query, variables ? { variables } : undefined)).json();
  return body.data;
}

function check(result: { userErrors?: { message: string }[] } | null | undefined, step: string) {
  const errors = result?.userErrors ?? [];
  if (!result || errors.length > 0) {
    throw new Error(`${step}: ${errors.map((e) => e.message).join(" ") || "no response"}`);
  }
}

/**
 * Make sure the members-only checkout rule is on for this shop and knows
 * every plan tag. Safe to call often: it creates the validation once and
 * otherwise only rewrites its settings.
 */
export async function syncMembersOnly(admin: Admin, shop: string) {
  const plans = await prisma.membershipPlan.findMany({ where: { shop }, select: { tag: true } });
  const value = membersOnlyConfig(plans.map((p) => p.tag));

  const existing = ((await call(admin, VALIDATIONS))?.validations?.nodes ?? []).find(
    (v: { shopifyFunction?: { handle?: string } }) =>
      v.shopifyFunction?.handle === FUNCTION_HANDLE,
  ) as { id: string; enabled: boolean } | undefined;

  if (!existing) {
    const created = (
      await call(admin, VALIDATION_CREATE, {
        validation: {
          functionHandle: FUNCTION_HANDLE,
          title: "Members-only products",
          enable: true,
          // If the function itself fails, let checkout continue rather than
          // blocking every order in the store.
          blockOnFailure: false,
          metafields: [{ ...CONFIG, type: "json", value }],
        },
      })
    )?.validationCreate;
    check(created, "turn on the members-only rule");
    return { validationId: created.validation.id as string, enabled: true };
  }

  const set = (
    await call(admin, METAFIELDS_SET, {
      metafields: [{ ...CONFIG, ownerId: existing.id, type: "json", value }],
    })
  )?.metafieldsSet;
  check(set, "update the members-only rule");
  return { validationId: existing.id, enabled: existing.enabled };
}

export async function membersOnlyProducts(admin: Admin) {
  return ((await call(admin, PRODUCTS))?.products?.nodes ?? []) as {
    id: string;
    title: string;
    status: string;
  }[];
}

export async function setMembersOnly(admin: Admin, productIds: string[], on: boolean) {
  for (const id of productIds) {
    const field = on ? "tagsAdd" : "tagsRemove";
    const result = (await call(admin, on ? TAGS_ADD : TAGS_REMOVE, { id, tags: [MEMBERS_ONLY_TAG] }))?.[
      field
    ];
    check(result, on ? "mark the product members-only" : "make the product open to all");
  }
}

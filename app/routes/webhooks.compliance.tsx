import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logAccess } from "../membership/dataCrypto.server";
import {
  redactCustomer,
  redactShop,
} from "../membership/privacy.server";

type CompliancePayload = {
  shop_domain?: string;
  customer?: { id?: number };
  data_request?: { id?: number };
};

// customers/data_request, customers/redact and shop/redact. authenticate.webhook
// checks Shopify's signature and answers 401 to anything else, as review requires.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, webhookId } = await authenticate.webhook(request);
  const body = payload as CompliancePayload;
  const customerId = body.customer?.id;

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST": {
      if (!customerId) break;
      // Saved for the merchant, who downloads the data on the Privacy requests
      // page (never written to the app log: it holds personal data). Shopify's
      // request ID, else the webhook's, which stays the same when Shopify resends it.
      const requestId = String(body.data_request?.id ?? webhookId);
      await prisma.dataRequest.upsert({
        where: { shop_requestId: { shop, requestId } },
        create: { shop, customerId: String(customerId), requestId },
        update: {},
      });
      await logAccess(shop, "shopify:customers/data_request", "data request saved for the merchant", String(customerId));
      break;
    }
    case "CUSTOMERS_REDACT": {
      if (!customerId) break;
      const deleted = await redactCustomer(shop, customerId);
      await logAccess(shop, "shopify:customers/redact", "customer data deleted", String(customerId));
      console.log(`customers/redact for ${shop}, customer ${customerId}:`, deleted);
      break;
    }
    case "SHOP_REDACT": {
      const deleted = await redactShop(shop);
      console.log(`shop/redact for ${shop}:`, deleted);
      break;
    }
  }
  return new Response();
};

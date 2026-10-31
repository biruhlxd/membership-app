import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  customerData,
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
  const { shop, topic, payload } = await authenticate.webhook(request);
  const body = payload as CompliancePayload;
  const customerId = body.customer?.id;

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST": {
      if (!customerId) break;
      // TODO(emails): send this to the merchant; for now it is logged so the
      // request can be answered by hand within Shopify's 30 days.
      const data = await customerData(shop, customerId);
      console.log(
        `customers/data_request ${body.data_request?.id ?? ""} for ${shop}:`,
        JSON.stringify(data),
      );
      break;
    }
    case "CUSTOMERS_REDACT": {
      if (!customerId) break;
      const deleted = await redactCustomer(shop, customerId);
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

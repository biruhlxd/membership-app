import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { verifyPage } from "../membership/verifyPage";
import { openField } from "../membership/dataCrypto.server";
import { unauthenticated } from "../shopify.server";

const SHOP_NAME = `#graphql
  query verifyShopName {
    shop {
      name
    }
  }`;

// Public: /verify/<code>, the link printed on certificates. The code is random
// and unguessable; the page shows the credential and the holder's short name.
export const loader = async ({ params }: LoaderFunctionArgs) => {
  const credential = await prisma.credential.findUnique({
    where: { verifyCode: params.code ?? "" },
    include: { type: { select: { name: true } } },
  });
  let shopName = credential ? credential.shop.replace(/\.myshopify\.com$/, "") : "";
  if (credential) {
    try {
      const { admin } = await unauthenticated.admin(credential.shop);
      const json = (await (await admin.graphql(SHOP_NAME)).json()) as { data?: { shop?: { name?: string } } };
      shopName = json.data?.shop?.name || shopName;
    } catch {
      // The store's handle is shown instead.
    }
  }
  const html = verifyPage({
    shopName,
    credential:
      credential && credential.status !== "PENDING" && credential.status !== "REJECTED"
        ? {
            type: credential.type.name,
            number: credential.number,
            holderName: openField(credential.holderName),
            status: credential.status,
            issuedAt: credential.issuedAt,
            expiresAt: credential.expiresAt,
          }
        : null,
  });
  return new Response(html, {
    status: credential ? 200 : 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
};

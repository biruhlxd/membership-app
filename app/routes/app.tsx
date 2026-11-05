import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { ensureAppUrl } from "../membership/appUrl.server";
import { refreshAppPlanSoon } from "../membership/appBilling.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await authenticate.admin(request);
  const { admin, session } = context;
  // Tell the member portal where this server is (once per process).
  await ensureAppUrl(admin, session.shop);
  // Keep the stored app plan current (also kept by the app_subscriptions/update webhook).
  await refreshAppPlanSoon(context);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/members">Members</s-link>
        <s-link href="/app/plans">Plans</s-link>
        <s-link href="/app/members-only">Members-only products</s-link>
        <s-link href="/app/credentials">Credentials</s-link>
        <s-link href="/app/privacy-requests">Privacy requests</s-link>
        <s-link href="/app/billing">App plan</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

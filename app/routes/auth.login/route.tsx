import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { login } from "../../shopify.server";

// Where the Shopify library sends a request it can't tie to a shop. Installs
// start from the App Store or the admin, never from a typed shop address, so
// there is no shop-domain form: a request from Shopify (with `shop`) goes on
// to Shopify's sign-in, anything else to the app's public page.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (new URL(request.url).searchParams.get("shop")) await login(request);
  throw redirect("/");
};

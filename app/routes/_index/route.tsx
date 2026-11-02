import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import styles from "./styles.module.css";

// The app's public address. Opened from the Shopify admin it goes straight
// into the app; there is no shop-domain form (Shopify installs start from the
// App Store or the admin, never from a typed shop address).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export default function App() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>
          Memberships for associations and education
        </h1>
        <p className={styles.text}>
          Sell memberships on Shopify with joining and renewal prices, member
          pricing and members-only products, and keep members in step with your
          learning platform.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>Memberships that renew</strong>. A joining price and a
            renewal price, automatic renewals, and retries when a card fails.
          </li>
          <li>
            <strong>Member benefits</strong>. Member prices and members-only
            products, given by the plan&apos;s customer tag and removed when a
            membership ends.
          </li>
          <li>
            <strong>A member portal</strong>. Members see their plan and next
            renewal, and can update their card or cancel, in their account.
          </li>
          <li>
            <strong>Organizations and credentials</strong>. Seats for
            organizations, and credentials earned from courses and plans, with a
            public verification page.
          </li>
        </ul>
        <p className={styles.text}>
          Install from the Shopify App Store. <a href="/privacy">Privacy policy</a>
        </p>
      </div>
    </div>
  );
}

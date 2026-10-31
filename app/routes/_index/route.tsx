import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

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
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
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
        </ul>
      </div>
    </div>
  );
}

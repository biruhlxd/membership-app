import '@shopify/ui-extensions/preact';
import {render} from 'preact';

// On the order status page of an order that has a membership (a line bought
// with a selling plan): a link to the member portal, where the member sees
// their plan and renewal, updates their card or cancels. Shopify's
// subscription app requirement 5.4.9.

export default async () => {
  render(<OrderStatusLink />, document.body);
};

function OrderStatusLink() {
  const lines = shopify.lines?.value ?? [];
  const hasMembership = lines.some((line) => Boolean(line.merchandise?.sellingPlan));
  if (!hasMembership) return null;
  const t = (key) => shopify.i18n.translate(key);
  return (
    <s-section heading={t('orderStatus.heading')}>
      <s-stack gap="small-200">
        <s-paragraph>{t('orderStatus.body')}</s-paragraph>
        <s-link href="extension:member-portal/">{t('orderStatus.link')}</s-link>
      </s-stack>
    </s-section>
  );
}

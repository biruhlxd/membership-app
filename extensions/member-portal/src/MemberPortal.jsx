import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

// The member's own page in the customer account: each membership with its
// status, next renewal and price, and a way to cancel. Reads and writes go
// through the Customer Account API as the signed-in member.

export default async () => {
  render(<MemberPortal />, document.body);
};

const API = 'shopify://customer-account/api/2026-10/graphql.json';

const CONTRACTS = `query MemberContracts {
  customer {
    subscriptionContracts(first: 10) {
      nodes {
        id
        status
        nextBillingDate
        currencyCode
        lines(first: 5) {
          nodes {
            name
            currentPrice { amount currencyCode }
          }
        }
      }
    }
  }
}`;

const CANCEL = `mutation MemberCancel($id: ID!) {
  subscriptionContractCancel(subscriptionContractId: $id) {
    contract { id status }
    userErrors { field message code }
  }
}`;

async function gql(query, variables) {
  const response = await fetch(API, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({query, variables}),
  });
  const body = await response.json();
  if (body.errors?.length) throw new Error(body.errors[0].message);
  return body.data;
}

const t = (key, options) => shopify.i18n.translate(key, options);

// Customer account badges take only auto, neutral or critical.
const toneFor = (status) =>
  status === 'ACTIVE' ? 'auto' : status === 'FAILED' ? 'critical' : 'neutral';

function MemberPortal() {
  const [contracts, setContracts] = useState(null);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    gql(CONTRACTS)
      .then((data) => setContracts(data.customer.subscriptionContracts.nodes))
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  const cancel = async (id) => {
    setBusy(true);
    try {
      const {subscriptionContractCancel: result} = await gql(CANCEL, {id});
      if (result.userErrors.length) throw new Error(result.userErrors[0].message);
      setConfirming(null);
      shopify.toast.show(t('cancelled'));
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !contracts) {
    return (
      <s-page heading={t('heading')}>
        <s-banner tone="critical">{t('loadError')}</s-banner>
      </s-page>
    );
  }
  if (!contracts) {
    return (
      <s-page heading={t('heading')}>
        <s-spinner accessibilityLabel={t('loading')} />
      </s-page>
    );
  }

  return (
    <s-page heading={t('heading')}>
      {error && <s-banner tone="critical">{error}</s-banner>}
      {contracts.length === 0 && (
        <s-section>
          <s-paragraph>{t('none')}</s-paragraph>
        </s-section>
      )}
      {contracts.map((c) => {
        const line = c.lines.nodes[0];
        const active = c.status === 'ACTIVE';
        return (
          <s-section key={c.id} heading={line?.name ?? t('membership')}>
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-badge tone={toneFor(c.status)}>
                  {t(`status.${c.status}`)}
                </s-badge>
              </s-stack>
              {active && c.nextBillingDate && (
                <s-text>
                  {t('nextRenewal', {
                    date: shopify.i18n.formatDate(new Date(c.nextBillingDate), {dateStyle: 'long'}),
                    price: line
                      ? shopify.i18n.formatCurrency(Number(line.currentPrice.amount), {
                          currency: line.currentPrice.currencyCode,
                        })
                      : '',
                  })}
                </s-text>
              )}
              {active && (
                <s-stack direction="inline" gap="base">
                  <s-link href="shopify:customer-account/profile">{t('updateCard')}</s-link>
                  {confirming !== c.id && (
                    <s-button variant="secondary" onClick={() => setConfirming(c.id)}>
                      {t('cancel')}
                    </s-button>
                  )}
                </s-stack>
              )}
              {confirming === c.id && (
                <s-banner tone="warning" heading={t('confirmHeading')}>
                  <s-stack direction="block" gap="base">
                    <s-text>{t('confirmBody')}</s-text>
                    <s-stack direction="inline" gap="base">
                      <s-button
                        variant="primary"
                        tone="critical"
                        loading={busy}
                        onClick={() => cancel(c.id)}
                      >
                        {t('confirmYes')}
                      </s-button>
                      <s-button variant="secondary" onClick={() => setConfirming(null)}>
                        {t('confirmNo')}
                      </s-button>
                    </s-stack>
                  </s-stack>
                </s-banner>
              )}
            </s-stack>
          </s-section>
        );
      })}
    </s-page>
  );
}

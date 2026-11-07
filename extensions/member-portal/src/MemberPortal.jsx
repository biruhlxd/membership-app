import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';
import {Organizations} from './Organizations.jsx';

// The member's own page in the customer account: each membership with its
// status, next renewal and price, and a way to cancel. Reads and writes go
// through the Customer Account API as the signed-in member.

export default async () => {
  render(<MemberPortal />, document.body);
};

const API = 'shopify://customer-account/api/2026-10/graphql.json';

const CONTRACTS = `query MemberContracts($after: String) {
  customer {
    subscriptionContracts(first: 25, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        status
        nextBillingDate
        currencyCode
        billingPolicy { interval intervalCount { count } }
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

// Every membership, a page at a time.
async function allContracts() {
  const contracts = [];
  let after = null;
  do {
    const page = (await gql(CONTRACTS, {after})).customer.subscriptionContracts;
    contracts.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return contracts;
}

const t = (key, options) => shopify.i18n.translate(key, options);

// Customer account badges take only auto, neutral or critical.
// A cancelled membership keeps access until the period already paid for
// ends: the date it would have renewed.
const endsLater = (c) =>
  c.status === 'CANCELLED' && c.nextBillingDate && new Date(c.nextBillingDate) > new Date();

const longDate = (iso) => shopify.i18n.formatDate(new Date(iso), {dateStyle: 'long'});

const toneFor = (status) =>
  status === 'ACTIVE' ? 'auto' : status === 'FAILED' ? 'critical' : 'neutral';

function MemberPortal() {
  const [contracts, setContracts] = useState(null);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    allContracts()
      .then(setContracts)
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
                    date: longDate(c.nextBillingDate),
                    price: line
                      ? shopify.i18n.formatCurrency(Number(line.currentPrice.amount), {
                          currency: line.currentPrice.currencyCode,
                        })
                      : '',
                  })}
                </s-text>
              )}
              {active && c.billingPolicy && (
                <s-text color="subdued">
                  {t(`every.${c.billingPolicy.interval}`, {
                    count: c.billingPolicy.intervalCount?.count ?? 1,
                  })}
                </s-text>
              )}
              {endsLater(c) && (
                <s-text>{t('accessUntil', {date: longDate(c.nextBillingDate)})}</s-text>
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
                    <s-text>
                      {c.nextBillingDate
                        ? t('confirmBody', {date: longDate(c.nextBillingDate)})
                        : t('confirmBodyNow')}
                    </s-text>
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
      <Organizations />
    </s-page>
  );
}

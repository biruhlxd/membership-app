import '@shopify/ui-extensions/preact';
import {useEffect, useState} from 'preact/hooks';

// Organization seats in the member portal: organizations this customer runs
// (seats, invite, end), invitations waiting for them, and seats they hold.
// Talks to the app's own server (/api/portal) with Shopify's session token;
// the server's address comes from the shop's $app.app_url metafield. If the
// server can't be reached, this part stays hidden and the rest of the page
// works as before.

const API = 'shopify://customer-account/api/2026-10/graphql.json';
const APP_URL = `query PortalAppUrl {
  shop {
    metafield(namespace: "$app", key: "app_url") {
      value
    }
  }
}`;

const t = (key, options) => shopify.i18n.translate(key, options);

// The field's current value (Shopify's documented event.currentTarget.value).
const fieldValue = (event) => event.currentTarget.value;

async function appUrl() {
  const response = await fetch(API, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({query: APP_URL}),
  });
  const body = await response.json();
  const url = body.data?.shop?.metafield?.value;
  if (!url) throw new Error('app address unknown');
  return url.replace(/\/$/, '');
}

async function callApp(method, body) {
  const [base, token] = await Promise.all([appUrl(), shopify.sessionToken.get()]);
  const response = await fetch(`${base}/api/portal`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? {'Content-Type': 'application/json'} : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return response.json();
}

export function Organizations() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [inviteEmail, setInviteEmail] = useState({});
  const [inviteTag, setInviteTag] = useState({});

  const load = () =>
    callApp('GET')
      .then((data) => setState(data && !data.error ? data : null))
      .catch(() => setState(null));

  useEffect(() => {
    load();
  }, []);

  const act = async (body) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await callApp('POST', body);
      setMessage(result.ok ? {tone: 'success', text: result.message} : {tone: 'critical', text: result.error});
      if (result.ok) {
        shopify.toast.show(result.message);
        await load();
      }
    } catch (e) {
      setMessage({tone: 'critical', text: t('org.error')});
    } finally {
      setBusy(false);
    }
  };

  if (!state) return null;
  const {organizations, invitations, seats} = state;
  if (!organizations.length && !invitations.length && !seats.length) return null;

  return (
    <s-stack direction="block" gap="base">
      {message && <s-banner tone={message.tone === 'critical' ? 'critical' : 'info'}>{message.text}</s-banner>}

      {invitations.map((inv) => (
        <s-section key={inv.id} heading={t('org.invitationHeading')}>
          <s-stack direction="block" gap="base">
            <s-text>{t('org.invitationBody', {seat: inv.seatName, plan: inv.planName})}</s-text>
            <s-stack direction="inline" gap="base">
              <s-button variant="primary" loading={busy} onClick={() => act({intent: 'accept', seatId: inv.id})}>
                {t('org.accept')}
              </s-button>
              <s-button variant="secondary" onClick={() => act({intent: 'decline', seatId: inv.id})}>
                {t('org.decline')}
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      ))}

      {seats.map((seat) => (
        <s-section key={seat.id} heading={t('org.seatHeading', {seat: seat.seatName})}>
          <s-text>
            {seat.active
              ? t('org.seatActive', {plan: seat.planName})
              : t('org.seatPaused', {plan: seat.planName})}
          </s-text>
        </s-section>
      ))}

      {organizations.map((org) => (
        <s-section key={org.id} heading={t('org.manageHeading', {plan: org.planName})}>
          <s-stack direction="block" gap="base">
            {!org.active && <s-banner tone="critical">{t('org.inactive')}</s-banner>}
            {org.seatTypes.map((type) => (
              <s-text key={type.tag}>
                {t('org.usage', {seat: type.name, used: type.used, total: type.seats})}
              </s-text>
            ))}
            {org.seats.map((seat) => (
              <s-stack key={seat.id} direction="inline" gap="base" alignItems="center">
                <s-text>{seat.email}</s-text>
                <s-text color="subdued">{seat.seatName}</s-text>
                <s-badge tone={seat.status === 'ACTIVE' ? 'auto' : 'neutral'}>
                  {seat.status === 'ACTIVE' ? t('org.statusActive') : t('org.statusInvited')}
                </s-badge>
                <s-button variant="secondary" onClick={() => act({intent: 'endSeat', seatId: seat.id})}>
                  {seat.status === 'ACTIVE' ? t('org.endSeat') : t('org.withdraw')}
                </s-button>
              </s-stack>
            ))}
            {org.active && (
              <s-stack direction="block" gap="base">
                <s-text type="strong">{t('org.inviteHeading')}</s-text>
                <s-email-field
                  label={t('org.inviteEmail')}
                  name={`email-${org.id}`}
                  value={inviteEmail[org.id] ?? ''}
                  onInput={(e) => setInviteEmail({...inviteEmail, [org.id]: fieldValue(e)})}
                />
                <s-select
                  label={t('org.inviteSeat')}
                  name={`seat-${org.id}`}
                  value={inviteTag[org.id] ?? org.seatTypes[0]?.tag ?? ''}
                  onChange={(e) => setInviteTag({...inviteTag, [org.id]: fieldValue(e)})}
                >
                  {org.seatTypes.map((type) => (
                    <s-option key={type.tag} value={type.tag}>
                      {t('org.seatOption', {seat: type.name, left: type.left})}
                    </s-option>
                  ))}
                </s-select>
                <s-button
                  variant="primary"
                  loading={busy}
                  onClick={() =>
                    act({
                      intent: 'invite',
                      organizationId: org.id,
                      email: inviteEmail[org.id] ?? '',
                      tag: inviteTag[org.id] ?? org.seatTypes[0]?.tag ?? '',
                    }).then(() => setInviteEmail({...inviteEmail, [org.id]: ''}))
                  }
                >
                  {t('org.invite')}
                </s-button>
              </s-stack>
            )}
          </s-stack>
        </s-section>
      ))}
    </s-stack>
  );
}

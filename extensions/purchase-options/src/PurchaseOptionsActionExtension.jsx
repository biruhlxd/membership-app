import '@shopify/ui-extensions/preact';
import {useEffect, useState} from 'preact/hooks';

// Create or edit a membership plan from the "Purchase options" card on a
// Shopify product or variant page. The app's server does the work
// (/api/purchase-options), exactly as the app's Plans page does: it makes the
// selling plan group, prices the product, and sets up member pricing.

const t = (key, options) => shopify.i18n.translate(key, options);
const fieldValue = (event) => event.currentTarget.value;

const EMPTY = {
  name: '',
  tag: '',
  joiningPrice: '',
  renewalPrice: '',
  interval: 'YEAR',
  intervalCount: '1',
  memberDiscount: '',
};

async function callApp(method, path, body) {
  const token = await shopify.auth.idToken();
  const response = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? {'Content-Type': 'application/json'} : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return response.json();
}

export default function PurchaseOptionsActionExtension() {
  const {close, data} = shopify;
  const selected = data.selected?.[0] ?? {};
  const groupId = selected.sellingPlanId || '';
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(Boolean(groupId));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [editable, setEditable] = useState(true);
  const [members, setMembers] = useState(0);

  useEffect(() => {
    if (!groupId) return;
    callApp('GET', `/api/purchase-options?groupId=${encodeURIComponent(groupId)}`)
      .then((body) => {
        setEditable(Boolean(body.editable && body.plan));
        if (body.plan) {
          setForm({...EMPTY, ...body.plan});
          setMembers(body.plan.memberCount ?? 0);
        }
      })
      .catch(() => setMessage(t('loadError')))
      .finally(() => setLoading(false));
  }, [groupId]);

  const set = (key) => (event) => setForm((current) => ({...current, [key]: fieldValue(event)}));

  async function save() {
    setSaving(true);
    setErrors({});
    setMessage('');
    try {
      const result = await callApp('POST', '/api/purchase-options', {
        ...form,
        resourceId: selected.id,
        groupId,
      });
      if (result.ok) {
        close();
        return;
      }
      setErrors(result.errors ?? {});
      setMessage(result.error ?? '');
    } catch {
      setMessage(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <s-admin-action heading={t('editHeading')} loading>
        <s-spinner accessibilityLabel={t('loading')}></s-spinner>
      </s-admin-action>
    );
  }

  if (!editable) {
    return (
      <s-admin-action heading={t('editHeading')}>
        <s-button slot="secondary-actions" onClick={() => close()}>
          {t('close')}
        </s-button>
        <s-banner tone="warning">{message || t('notEditable')}</s-banner>
      </s-admin-action>
    );
  }

  return (
    <s-admin-action heading={groupId ? t('editHeading') : t('createHeading')}>
      <s-button slot="primary-action" variant="primary" loading={saving} onClick={save}>
        {t('save')}
      </s-button>
      <s-button slot="secondary-actions" onClick={() => close()}>
        {t('cancel')}
      </s-button>
      <s-stack direction="block" gap="base">
        {message && <s-banner tone="critical">{message}</s-banner>}
        {members > 0 && <s-banner tone="info">{t('membersKeepTerms', {count: members})}</s-banner>}
        <s-text-field label={t('name')} value={form.name} error={errors.name} onChange={set('name')} required></s-text-field>
        <s-text-field
          label={t('tag')}
          details={t('tagDetails')}
          value={form.tag}
          error={errors.tag}
          onChange={set('tag')}
          required
        ></s-text-field>
        <s-stack direction="inline" gap="base">
          <s-money-field label={t('joiningPrice')} value={form.joiningPrice} error={errors.joiningPrice} onChange={set('joiningPrice')} min={0} required></s-money-field>
          <s-money-field label={t('renewalPrice')} value={form.renewalPrice} error={errors.renewalPrice} onChange={set('renewalPrice')} min={0} required></s-money-field>
        </s-stack>
        <s-stack direction="inline" gap="base">
          <s-number-field
            label={t('every')}
            value={form.intervalCount}
            error={errors.intervalCount}
            onChange={set('intervalCount')}
            min={1}
            max={36}
            step={1}
          ></s-number-field>
          <s-select label={t('period')} value={form.interval} error={errors.interval} onChange={set('interval')}>
            <s-option value="MONTH">{t('months')}</s-option>
            <s-option value="YEAR">{t('years')}</s-option>
          </s-select>
        </s-stack>
        <s-number-field
          label={t('memberDiscount')}
          details={t('memberDiscountDetails')}
          value={form.memberDiscount}
          error={errors.memberDiscount}
          onChange={set('memberDiscount')}
          min={0}
          max={100}
          suffix="%"
        ></s-number-field>
        <s-paragraph color="subdued">{t('seatsElsewhere')}</s-paragraph>
      </s-stack>
    </s-admin-action>
  );
}

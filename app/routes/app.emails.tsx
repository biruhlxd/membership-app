import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { DEFAULTS, PLACEHOLDERS, unknownPlaceholders, type Look, type TemplateKind } from "../membership/emailTemplates";
import {
  lookFor,
  previewEmail,
  resetTemplate,
  saveLook,
  saveTemplate,
  sendTestEmail,
  templateFor,
} from "../membership/emails.server";

// The member emails a merchant can edit: the sender and look used by every
// email, and the welcome email of each plan.
const MAX_SUBJECT = 200;
const MAX_HTML = 50_000;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const plans = await prisma.membershipPlan.findMany({ where: { shop }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return {
    look: await lookFor(shop),
    welcomes: await Promise.all(
      plans.map(async (p) => ({ kind: "WELCOME" as TemplateKind, planId: p.id, planName: p.name, ...(await templateFor(shop, "WELCOME", p.id)) })),
    ),
    seatWelcome: { kind: "SEAT_WELCOME" as TemplateKind, planId: "", planName: "", ...(await templateFor(shop, "SEAT_WELCOME")) },
    sending: Boolean(process.env.SMTP_HOST && process.env.EMAIL_FROM),
    welcomeOff: /\b(WELCOME|ALL)\b/.test((process.env.EMAILS_OFF ?? "").toUpperCase()),
  };
};

type Result = { ok: boolean; message?: string; preview?: { subject: string; html: string } };

export const action = async ({ request }: ActionFunctionArgs): Promise<Result> => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent"));
  if (intent === "look") {
    const problem = await saveLook(shop, {
      senderName: String(form.get("senderName") ?? ""),
      logoUrl: String(form.get("logoUrl") ?? ""),
      accentColor: String(form.get("accentColor") ?? ""),
      buttonColor: String(form.get("buttonColor") ?? ""),
      footerHtml: String(form.get("footerHtml") ?? ""),
      signInPath: String(form.get("signInPath") ?? ""),
    });
    return problem ? { ok: false, message: problem } : { ok: true, message: "Saved. Every email uses it from now on." };
  }
  // A plan's welcome, or the one sub-account welcome (no plan).
  const kind: TemplateKind = form.get("kind") === "SEAT_WELCOME" ? "SEAT_WELCOME" : "WELCOME";
  const plan =
    kind === "SEAT_WELCOME"
      ? { id: "", name: "" }
      : await prisma.membershipPlan.findFirst({ where: { shop, id: String(form.get("planId")) }, select: { id: true, name: true } });
  if (!plan) return { ok: false, message: "Unknown plan." };
  const draft = { subject: String(form.get("subject") ?? ""), html: String(form.get("html") ?? "") };
  if (draft.subject.length > MAX_SUBJECT || draft.html.length > MAX_HTML) {
    return { ok: false, message: `Keep the subject under ${MAX_SUBJECT} characters and the HTML under ${MAX_HTML}.` };
  }
  switch (intent) {
    case "save": {
      if (!draft.subject.trim() || !draft.html.trim()) return { ok: false, message: "The subject and the HTML can't be empty." };
      await saveTemplate(shop, kind, plan.id, { enabled: form.get("enabled") === "true", ...draft });
      const unknown = unknownPlaceholders(draft.subject + draft.html);
      return {
        ok: unknown.length === 0,
        message: unknown.length
          ? `Saved, but these placeholders don't exist and will show as typed: ${unknown.map((n) => `{{${n}}}`).join(", ")}.`
          : "Saved.",
      };
    }
    case "toggle": {
      const current = await templateFor(shop, kind, plan.id);
      const enabled = form.get("enabled") === "true";
      await saveTemplate(shop, kind, plan.id, { enabled, subject: current.subject, html: current.html });
      return { ok: true, message: enabled ? "Switched on." : "Switched off." };
    }
    case "reset":
      await resetTemplate(shop, kind, plan.id);
      return { ok: true, message: "Back to the default wording." };
    case "preview":
      return { ok: true, preview: await previewEmail(admin, shop, plan.name, draft) };
    case "test": {
      const sent = await sendTestEmail(admin, shop, plan.name, draft);
      return sent.ok ? { ok: true, message: `Test sent to ${sent.to}.` } : { ok: false, message: sent.message };
    }
    default:
      return { ok: false, message: "Unknown action." };
  }
};

export default function Emails() {
  const { look, welcomes, seatWelcome, sending, welcomeOff } = useLoaderData<typeof loader>();
  // One view at a time: the sender and look, one plan's welcome email, or the
  // sub-account welcome ("seat").
  const [view, setView] = useState<string>("look");
  const current = view === "seat" ? seatWelcome : welcomes.find((w) => w.planId === view);

  return (
    <s-page heading="Emails">
      {!sending && (
        <s-banner tone="warning">Email sending isn&apos;t set up on the app&apos;s server yet, so emails are recorded but not sent.</s-banner>
      )}
      {welcomeOff && (
        <s-banner tone="info">Welcome emails are switched off on this app&apos;s server, so none are sent whatever is set here.</s-banner>
      )}
      <s-stack gap="base">
        <s-button-group>
          <s-button slot="secondary-actions" variant={view === "look" ? "primary" : "secondary"} onClick={() => setView("look")}>
            Sender &amp; look
          </s-button>
          {welcomes.map((w) => (
            <s-button
              key={w.planId}
              slot="secondary-actions"
              variant={view === w.planId ? "primary" : "secondary"}
              onClick={() => setView(w.planId)}
            >
              {`Welcome: ${w.planName}${w.enabled ? "" : " (off)"}`}
            </s-button>
          ))}
          <s-button slot="secondary-actions" variant={view === "seat" ? "primary" : "secondary"} onClick={() => setView("seat")}>
            {`Sub-account welcome${seatWelcome.enabled ? "" : " (off)"}`}
          </s-button>
        </s-button-group>
        {welcomes.length === 0 && (
          <s-paragraph color="subdued">
            Each plan gets its own welcome email. Create a plan on the <s-link href="/app/plans">Plans</s-link> page first.
          </s-paragraph>
        )}
        {view === "look" && <LookEditor look={look} />}
        {current && <WelcomeEditor key={`${current.kind}:${current.planId}`} welcome={current} />}
      </s-stack>
    </s-page>
  );
}

function LookEditor({ look }: { look: Look }) {
  const fetcher = useFetcher<typeof action>();
  const [draft, setDraft] = useState(look);
  const set = (field: keyof Look, value: string) => setDraft((d) => ({ ...d, [field]: value }));
  return (
    <s-section heading="Sender & look">
      <s-stack gap="base">
        <s-paragraph color="subdued">Used by every member email. Leave a field empty to use your store&apos;s own.</s-paragraph>
        {fetcher.data?.message && <s-banner tone={fetcher.data.ok ? "success" : "critical"}>{fetcher.data.message}</s-banner>}
        <s-text-field
          label="Sender name"
          details="Shown as who the email is from. Empty: your store's name."
          value={draft.senderName}
          maxLength={100}
          onChange={(e) => set("senderName", e.currentTarget.value)}
        ></s-text-field>
        <s-url-field
          label="Logo"
          details="An https image address. Upload your logo in Shopify (Content › Files) and copy its link."
          value={draft.logoUrl}
          onChange={(e) => set("logoUrl", e.currentTarget.value)}
        ></s-url-field>
        {draft.logoUrl.startsWith("https://") && <s-thumbnail src={draft.logoUrl} alt="Logo" size="small"></s-thumbnail>}
        <s-color-field
          label="Accent colour"
          details="A stripe across the top of the email. Empty: none."
          value={draft.accentColor}
          onChange={(e) => set("accentColor", e.currentTarget.value)}
        ></s-color-field>
        <s-color-field
          label="Button colour"
          value={draft.buttonColor}
          onChange={(e) => set("buttonColor", e.currentTarget.value)}
        ></s-color-field>
        <s-text-area
          label="Footer"
          rows={3}
          details="HTML, shown at the bottom of every email: your organization's name, address, registration. Empty: your store's name."
          value={draft.footerHtml}
          onChange={(e) => set("footerHtml", e.currentTarget.value)}
        ></s-text-area>
        <s-text-field
          label="Page after signing in"
          details='Where {{sign_in_url}} takes members after they sign in, e.g. /pages/member-portal. Default: /account.'
          value={draft.signInPath}
          onChange={(e) => set("signInPath", e.currentTarget.value)}
        ></s-text-field>
        <s-stack direction="inline">
          <s-button
            variant="primary"
            loading={fetcher.state !== "idle"}
            onClick={() => fetcher.submit({ intent: "look", ...draft }, { method: "post" })}
          >
            Save
          </s-button>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

function WelcomeEditor({
  welcome,
}: {
  welcome: { kind: TemplateKind; planId: string; planName: string; enabled: boolean; subject: string; html: string; custom: boolean };
}) {
  const fetcher = useFetcher<typeof action>();
  const defaults = DEFAULTS[welcome.kind];
  const title = welcome.kind === "SEAT_WELCOME" ? defaults.title : `Welcome: ${welcome.planName}`;
  const [subject, setSubject] = useState(welcome.subject);
  const [html, setHtml] = useState(welcome.html);
  const busy = fetcher.state !== "idle";
  const post = (intent: string, extra: Record<string, string> = {}) =>
    fetcher.submit({ intent, kind: welcome.kind, planId: welcome.planId, subject, html, ...extra }, { method: "post" });
  const shown = fetcher.data?.preview;

  return (
    <s-section heading={title}>
      <s-stack gap="base">
        <s-switch
          label="Send this email"
          details={defaults.when}
          checked={welcome.enabled}
          onChange={() => post("toggle", { enabled: String(!welcome.enabled) })}
        ></s-switch>
        {fetcher.data?.message && <s-banner tone={fetcher.data.ok ? "success" : "warning"}>{fetcher.data.message}</s-banner>}
        <s-text-field label="Subject" value={subject} maxLength={MAX_SUBJECT} onChange={(e) => setSubject(e.currentTarget.value)}></s-text-field>
        <s-text-area
          label="HTML"
          rows={14}
          value={html}
          details="The middle of the email: the logo, accent and footer from Sender & look are added around it. Scripts and other active content are removed."
          onChange={(e) => setHtml(e.currentTarget.value)}
        ></s-text-area>
        <s-paragraph color="subdued">
          Placeholders:{" "}
          {Object.entries(PLACEHOLDERS)
            .map(([name, meaning]) => `{{${name}}} ${meaning.charAt(0).toLowerCase()}${meaning.slice(1)}`)
            .join(" · ")}
        </s-paragraph>
        <s-stack direction="inline" gap="small-200">
          <s-button variant="primary" loading={busy} onClick={() => post("save", { enabled: String(welcome.enabled) })}>
            Save
          </s-button>
          <s-button loading={busy} onClick={() => post("preview")}>
            Preview
          </s-button>
          <s-button loading={busy} onClick={() => post("test")}>
            Send test
          </s-button>
          {welcome.custom && (
            <s-button
              variant="tertiary"
              tone="critical"
              onClick={() => {
                post("reset");
                setSubject(defaults.subject);
                setHtml(defaults.html);
              }}
            >
              Reset to default
            </s-button>
          )}
        </s-stack>
        {shown && (
          <s-stack gap="small-200">
            <s-text type="strong">{`Subject: ${shown.subject}`}</s-text>
            <s-box border="base" borderRadius="base" padding="none">
              {/* Sandboxed: nothing in the HTML can run or reach the page. */}
              <iframe
                title={`${title} preview`}
                sandbox=""
                srcDoc={shown.html}
                style={{ width: "100%", height: 560, border: 0, background: "#f4f4f4" }}
              />
            </s-box>
          </s-stack>
        )}
      </s-stack>
    </s-section>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

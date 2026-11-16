import { describe, expect, it } from "vitest";
import {
  cleanHtml,
  DEFAULT_LOOK,
  DEFAULTS,
  htmlToText,
  render,
  safePath,
  SAMPLE,
  signInUrl,
  unknownPlaceholders,
} from "./emailTemplates";

describe("render", () => {
  it("fills placeholders, escaping them in the HTML only", () => {
    const r = render(
      { subject: "Welcome, {{first_name}}", html: "<p>Hi {{first_name}}, {{plan_name}}</p>" },
      { ...SAMPLE, first_name: "Ana & <b>Bo</b>" },
    );
    expect(r.subject).toBe("Welcome, Ana & <b>Bo</b>");
    expect(r.html).toContain("Hi Ana &amp; &lt;b&gt;Bo&lt;/b&gt;, Basic Membership");
    expect(r.text).toContain("Hi Ana & <b>Bo</b>, Basic Membership");
  });

  it("keeps an unknown placeholder visible and reports it", () => {
    expect(render({ subject: "x", html: "<p>{{frist_name}}</p>" }, SAMPLE).html).toContain("{{frist_name}}");
    expect(unknownPlaceholders("{{first_name}} {{frist_name}}")).toEqual(["frist_name"]);
  });

  it("wraps the content in the look: logo, accent stripe, footer, button colour", () => {
    const look = {
      ...DEFAULT_LOOK,
      logoUrl: "https://cdn.example.com/logo.png",
      accentColor: "#C8102E",
      buttonColor: "#002868",
      footerHtml: "USSEA &middot; EIN 82-2720402<script>x()</script>",
    };
    const r = render(DEFAULTS.WELCOME, SAMPLE, look);
    expect(r.html).toContain('src="https://cdn.example.com/logo.png"');
    expect(r.html).toContain("border-top:4px solid #C8102E");
    expect(r.html).toContain("background:#002868");
    expect(r.html).toContain("USSEA &middot; EIN 82-2720402");
    expect(r.html).not.toContain("<script");
    expect(r.text).toContain("USSEA · EIN 82-2720402");
  });

  it("falls back to the store's name without a footer, and skips an http logo", () => {
    const r = render(DEFAULTS.WELCOME, { ...SAMPLE, shop_name: "USSEA" }, { ...DEFAULT_LOOK, logoUrl: "http://x.com/l.png" });
    expect(r.html).not.toContain("<img");
    expect(r.html).toMatch(/color:#888888">USSEA</);
  });
});

describe("USSEA preset (scripts/ussea/emails.json)", () => {
  it("uses only known placeholders and renders with its look", async () => {
    const preset = (await import("../../scripts/ussea/emails.json")).default as {
      look: typeof DEFAULT_LOOK;
      welcomeByTag: Record<string, { subject: string; html: string }>;
    };
    expect(Object.keys(preset.welcomeByTag)).toEqual(["ussea-basic", "ussea-instructor", "ussea-coach", "ussea-org", "ussea-school"]);
    for (const t of Object.values(preset.welcomeByTag)) expect(unknownPlaceholders(t.subject + t.html)).toEqual([]);
    const r = render(preset.welcomeByTag["ussea-instructor"], SAMPLE, preset.look);
    expect(r.subject).toBe("Welcome to USSEA — Your instructor certification is ready");
    expect(r.html).toContain("background:#002868");
    expect(r.text).toContain("safety certification requirements");
    expect(r.text).toContain("EIN 82-2720402");
  });
});

describe("cleanHtml / htmlToText", () => {
  it("removes scripts, handlers and javascript: links", () => {
    const html = cleanHtml('<p onclick="x()">a</p><script>y()</script><a href="javascript:z()">b</a><iframe src="e"></iframe>');
    expect(html).toBe('<p>a</p><a href="#">b</a>');
  });

  it("keeps link targets in the text copy", () => {
    expect(htmlToText('<p>Go <a href="https://x.com">here</a></p>')).toBe("Go here (https://x.com)");
  });
});

describe("signInUrl", () => {
  it("lands on the chosen page after the store's login", () => {
    expect(signInUrl("https://ussea.us/", "/pages/member-portal")).toBe(
      "https://ussea.us/customer_authentication/login?return_to=%2Fpages%2Fmember-portal",
    );
  });

  it("with the member's email, fills it in and sends the code at once", () => {
    expect(signInUrl("https://ussea.us", "/pages/member-portal", "ana+1@example.com")).toBe(
      "https://ussea.us/customer_authentication/login?return_to=%2Fpages%2Fmember-portal&login_hint=ana%2B1%40example.com&login_hint_mode=submit",
    );
  });

  it("refuses anything that isn't a path on the store", () => {
    expect(safePath("https://evil.example")).toBe("/account");
    expect(safePath("/pages/member portal")).toBe("/account");
  });
});

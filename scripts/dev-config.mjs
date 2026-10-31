// Writes shopify.app.dev.toml (the "Biruh Membership (dev)" app, used by
// `npm run dev`) from shopify.app.toml (the live app at app.biruh.org), so
// both apps always have the same scopes, webhooks and settings. Only the
// app's identity and URLs differ. Run after editing shopify.app.toml:
//   npm run config:dev
import { readFileSync, writeFileSync } from "node:fs";

const DEV = {
  client_id: "f0b0ee64a6ee6150e3e58ddd9dceaa1f",
  name: "Biruh Membership (dev)",
};

let toml = readFileSync("shopify.app.toml", "utf8");
const set = (key, value) => {
  const line = new RegExp(`^${key} = .*$`, "m");
  if (!line.test(toml)) throw new Error(`shopify.app.toml has no ${key}`);
  toml = toml.replace(line, `${key} = ${value}`);
};

set("client_id", JSON.stringify(DEV.client_id));
set("name", JSON.stringify(DEV.name));
// Shopify CLI points the dev app at its tunnel on every `npm run dev`.
set("application_url", JSON.stringify("https://example.com"));
set("redirect_urls", '[ "https://example.com/api/auth" ]');
set("automatically_update_urls_on_dev", "true");

writeFileSync(
  "shopify.app.dev.toml",
  "# GENERATED from shopify.app.toml by scripts/dev-config.mjs. Do not edit.\n" + toml,
);
console.log("wrote shopify.app.dev.toml");

// Runs every fixture in tests/fixtures through Shopify's function runner and
// compares the output. (The generated vitest helper couldn't find the schema
// on Windows; the CLI runner is the same engine Shopify uses.)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fn = path.resolve(here, "..");
const fixtures = path.join(here, "fixtures");
const work = mkdtempSync(path.join(tmpdir(), "members-only-"));
const shopify = process.platform === "win32" ? "shopify.cmd" : "shopify";

let failed = 0;
for (const file of readdirSync(fixtures).filter((f) => f.endsWith(".json"))) {
  const { payload } = JSON.parse(readFileSync(path.join(fixtures, file), "utf8"));
  const input = path.join(work, "input.json");
  writeFileSync(input, JSON.stringify(payload.input));
  const raw = execFileSync(
    shopify,
    ["app", "function", "run", "--path", fn, "--input", input, "--export", payload.export, "--json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell: process.platform === "win32" },
  );
  const result = JSON.parse(raw);
  const output = result.output ?? result;
  const ok = JSON.stringify(output) === JSON.stringify(payload.output);
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${file}`);
  if (!ok) console.log(`  expected ${JSON.stringify(payload.output)}\n  got      ${JSON.stringify(output)}`);
}
process.exit(failed ? 1 : 0);

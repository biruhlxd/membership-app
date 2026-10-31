// Building on Windows writes the scripts folder into the server build as
// "build\client". On the Linux server that is not a path, so every /assets/
// script returns 404. Rewrite it with forward slashes, which both accept.
// Run after `npm run build` (scripts/deploy-live.sh does).
import { readFileSync, writeFileSync } from "node:fs";

const file = "build/server/index.js";
const source = readFileSync(file, "utf8");
const fixed = source.replace(
  /assetsBuildDirectory = "([^"]*)"/,
  (_match, dir) => `assetsBuildDirectory = "${dir.replace(/\\\\/g, "/")}"`,
);
const result = fixed.match(/assetsBuildDirectory = "([^"]*)"/)?.[1];
if (!result || result.includes("\\")) {
  throw new Error(`Could not fix the scripts folder path in ${file} (found ${result}).`);
}
writeFileSync(file, fixed);
console.log(`scripts folder in the server build: ${result}`);

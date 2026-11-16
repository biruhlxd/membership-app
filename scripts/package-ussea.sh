#!/usr/bin/env bash
# Builds the zip for USSEA Membership, which runs on USSEA's GoDaddy hosting
# (account of dev.ussea.us) through GoDaddy's "Deploy your Node.js app"
# (Upload a zip). Run from the project folder in Git Bash:
#   bash scripts/package-ussea.sh
# The zip lands on the Desktop. Then, if shopify.app.ussea.toml or
# extensions changed: npx shopify app deploy --config ussea
#
# The zip runs on MySQL/MariaDB: prisma/ holds the MySQL schema and
# migrations. `npm install` generates the Prisma client; `npm start` applies
# new migrations, then starts server.cjs. Settings (DATABASE_URL, SHOPIFY_*,
# APP_PLAN_FIXED, ...) are the app's environment variables in GoDaddy; the
# database password is in ~/ussea-membership-secrets/db_password on the server.
set -euo pipefail

if [ -n "$(git status --porcelain)" ]; then
  echo "Commit or stash your changes first; only committed code is packaged." >&2
  exit 1
fi

npm run build
node scripts/fix-build-paths.mjs

SHA=$(git rev-parse --short HEAD)
STAGE="$(mktemp -d)/ussea-membership"
mkdir -p "$STAGE"
git archive --format=tar HEAD | tar -xf - -C "$STAGE"
cp -r build "$STAGE/"

cd "$STAGE"
# Only what runs: no notes (CLAUDE.md has server details), tests or tools.
rm -rf extensions docs .github app/test prisma/dev.sqlite scripts Dockerfile AGENTS.md CHANGES.md CLAUDE.md README.md
find app -name "*.test.ts" -delete
rm -rf prisma/migrations prisma/schema.prisma
mv prisma/mysql/schema.prisma prisma/schema.prisma
mv prisma/mysql/migrations prisma/migrations
rm -rf prisma/mysql
node -e '
const fs = require("fs");
const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
p.scripts.postinstall = "prisma generate";
p.scripts.start = "prisma migrate deploy && node server.cjs";
fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
'

OUT="$HOME/Desktop/ussea-membership-$SHA.zip"
rm -f "$OUT"
# Windows' own tar writes zip files (-a picks the format from the name).
/c/Windows/System32/tar.exe -a -c -f "$(cygpath -w "$OUT")" *
echo "Packaged $SHA: $OUT ($(du -h "$OUT" | cut -f1))"

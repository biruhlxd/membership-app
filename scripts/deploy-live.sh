#!/usr/bin/env bash
# Deploys the committed code to the live app at https://app.biruh.org
# (cPanel Node.js app on biruh.org). Run from the project folder in Git Bash:
#   bash scripts/deploy-live.sh
# Then, if shopify.app.toml or extensions changed: npm run deploy
#
# Server layout (set up 2026-10-31):
#   ~/biruh-membership            app root (Passenger startup file server.cjs)
#   ~/nodevenv/biruh-membership/22 Node 22 and node_modules (CloudLinux)
#   ~/biruh-membership-secrets    env.json (app settings), db_password,
#                                 job_secret, run-renewals.sh (hourly cron)
#   ~/biruh-membership-logs       app.log
set -euo pipefail

SSH=(ssh -i ~/.ssh/biruh_org_claude -o BatchMode=yes -o ConnectTimeout=20 biruhorg@192.250.229.92)

if [ -n "$(git status --porcelain)" ]; then
  echo "Commit or stash your changes first; only committed code is deployed." >&2
  exit 1
fi

npm run build
PKG="$(mktemp -d)/app.tar"
git archive --format=tar HEAD > "$PKG"
tar --force-local -rf "$PKG" build

"${SSH[@]}" 'set -e
APP=biruh-membership
rm -rf ~/$APP.new && mkdir -p ~/$APP.new && tar -xf - -C ~/$APP.new
rm -rf ~/$APP.old && mv ~/$APP ~/$APP.old && mv ~/$APP.new ~/$APP
cp ~/$APP.old/stderr.log ~/$APP/ 2>/dev/null || true
source ~/nodevenv/$APP/22/bin/activate
cd ~/$APP
npm ci --omit=dev --no-audit --no-fund 2>&1 | tail -1
export DATABASE_URL="$(node -e "console.log(JSON.parse(require(\"fs\").readFileSync(process.env.HOME+\"/biruh-membership-secrets/env.json\",\"utf8\")).DATABASE_URL)")"
npx prisma generate --schema prisma/mysql/schema.prisma 2>&1 | grep -i generated
npx prisma migrate deploy --schema prisma/mysql/schema.prisma 2>&1 | grep -iE "applied|No pending|error"
cloudlinux-selector restart --json --interpreter nodejs --app-root $APP | grep -o "\"result\": *\"[a-z]*\""
sleep 3
curl -s -o /dev/null -w "https://app.biruh.org -> HTTP %{http_code}\n" https://app.biruh.org/
' < "$PKG"

rm -f "$PKG"
echo "Deployed $(git rev-parse --short HEAD)."

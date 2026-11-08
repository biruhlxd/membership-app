#!/usr/bin/env bash
# Deploys the committed code to the live app at https://membership.edtechtools.shop
# (cPanel Node.js app on biruh.org). Run from the project folder in Git Bash:
#   bash scripts/deploy-live.sh
# Then, if shopify.app.toml or extensions changed: npm run deploy
#
# The account is shared with Biruh's WordPress and Moodle sites and capped at
# 100 processes, counting threads (CloudLinux NPROC). On 2026-11-01 the app
# and a stuck deploy filled that cap and took every site down. So this script
# uses ONE SSH session, installs with the app stopped, measures the app after
# starting it (also under 5 parallel requests), and stops it again if it is
# over the limits below.
#
# Server layout (set up 2026-10-31):
#   ~/biruh-membership            app root (Passenger startup file server.cjs)
#   ~/nodevenv/biruh-membership/22 Node 22 and node_modules (CloudLinux)
#   ~/biruh-membership-secrets    env.json (app settings), db_password,
#                                 job_secret, run-renewals.sh (hourly cron)
#   ~/biruh-membership-engine     Prisma engine (PRISMA_QUERY_ENGINE_LIBRARY)
#   ~/biruh-membership-logs       app.log
set -euo pipefail

SSH=(ssh -i ~/.ssh/biruh_org_claude -o BatchMode=yes -o ConnectTimeout=30 biruhorg@192.250.229.92)

if [ -n "$(git status --porcelain)" ]; then
  echo "Commit or stash your changes first; only committed code is deployed." >&2
  exit 1
fi

npm run build
node scripts/fix-build-paths.mjs
PKG="$(mktemp -d)/app.tar"
git archive --format=tar HEAD > "$PKG"
tar --force-local -rf "$PKG" build

REMOTE=$(cat <<'EOF'
APP=biruh-membership
threads() { ps -u biruhorg -L --no-headers | wc -l; }
# This app's Node processes (pid and thread count): those running from its
# folder. Moodle Bridge runs on the same account; never count or stop it.
copies() {
  for p in $(pgrep -u biruhorg -f "lsnode|server.cjs"); do
    # Node only: this script's own shell also runs from the app folder and its
    # command line contains the search words.
    case "$(ps -o comm= -p $p 2>/dev/null)" in bash|sh|pgrep|ps|grep) continue ;; esac
    [ "$(readlink /proc/$p/cwd 2>/dev/null)" = "$HOME/$APP" ] && echo "$p $(ps -o nlwp= -p $p | tr -d ' ')"
  done
}
echo "before: $(ps -u biruhorg --no-headers | wc -l) processes, $(threads) threads"
if [ "$(threads)" -gt 60 ]; then echo "ACCOUNT BUSY, nothing changed"; cat >/dev/null; exit 1; fi

rm -rf ~/$APP.new && mkdir -p ~/$APP.new && tar -xf - -C ~/$APP.new || { echo "UPLOAD FAILED"; exit 1; }
# Free the app's threads while installing.
cloudlinux-selector stop --json --interpreter nodejs --app-root $APP >/dev/null
sleep 2
for p in $(copies | awk '{print $1}'); do kill $p 2>/dev/null; done
# Keep the current folder as the fallback only if its deploy finished
# (marker .deployed); after an interrupted deploy, keep the older fallback.
if [ -f ~/$APP/.deployed ]; then rm -rf ~/$APP.old && mv ~/$APP ~/$APP.old; else rm -rf ~/$APP; fi
mv ~/$APP.new ~/$APP
source ~/nodevenv/$APP/22/bin/activate
export TOKIO_WORKER_THREADS=2
cd ~/$APP
# --ignore-scripts: install scripts (esbuild) are only for building, which
# happens locally. The Prisma engines download is run explicitly.
npm ci --omit=dev --ignore-scripts --no-audit --no-fund 2>&1 | tail -1
node node_modules/@prisma/engines/scripts/postinstall.js 2>&1 | tail -1
export DATABASE_URL="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.HOME+'/biruh-membership-secrets/env.json','utf8')).DATABASE_URL)")"
npx prisma generate --schema prisma/mysql/schema.prisma 2>&1 | tail -1
npx prisma migrate deploy --schema prisma/mysql/schema.prisma 2>&1 | tail -1
mkdir -p ~/biruh-membership-engine
cp ~/nodevenv/$APP/22/lib/node_modules/.prisma/client/libquery_engine-debian-openssl-1.1.x.so.node ~/biruh-membership-engine/

cloudlinux-selector start --json --interpreter nodejs --app-root $APP >/dev/null
sleep 2
# A cold start can take some seconds: ask again for up to 30 seconds.
for i in 1 2 3 4 5 6 7 8 9 10; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" https://membership.edtechtools.shop/)
  case "$CODE" in 2*|3*) break ;; esac
  sleep 3
done
echo "https://membership.edtechtools.shop -> HTTP $CODE"
for i in 1 2 3 4 5; do curl -s -o /dev/null https://membership.edtechtools.shop/ & done; wait
sleep 3
COPIES=$(copies | wc -l); MAXT=$(copies | awk 'BEGIN{m=0}{if($2>m)m=$2}END{print m}'); TOTAL=$(threads)
echo "under load: copies=$COPIES, most threads in one copy=$MAXT, account threads=$TOTAL"
if [ "$COPIES" -gt 2 ] || [ "$MAXT" -gt 20 ] || [ "$TOTAL" -gt 60 ]; then
  echo "OVER LIMITS: stopping the app again"
  cloudlinux-selector stop --json --interpreter nodejs --app-root $APP >/dev/null
  sleep 2; for p in $(copies | awk '{print $1}'); do kill $p 2>/dev/null; done
  exit 2
fi
A=$(ls build/client/assets | grep "^entry.client" | head -1)
curl -s -o /dev/null -w "scripts -> HTTP %{http_code}\n" https://membership.edtechtools.shop/assets/$A
# Mark this deploy as finished, so the next one keeps it as the fallback.
touch ~/$APP/.deployed
echo "after: $(ps -u biruhorg --no-headers | wc -l) processes, $(threads) threads"
EOF
)

"${SSH[@]}" "$REMOTE" < "$PKG"
rm -f "$PKG"
echo "Deployed $(git rev-parse --short HEAD)."

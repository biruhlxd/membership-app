#!/usr/bin/env bash
# Deploys the committed code to USSEA Membership at https://membership-app.ussea.us,
# or with "dev" to USSEA Membership (dev) at https://membership-app-dev.ussea.us
# (ussea-dev-store, tested with dev.ussea.us; names below with -dev, port 3101).
# (Biruh's Hostinger VPS, shared with learn/demo.edtechtools.shop). Run from
# the project folder in Git Bash:
#   bash scripts/deploy-ussea.sh        live
#   bash scripts/deploy-ussea.sh dev    dev
# Then, if shopify.app.ussea.toml or extensions changed:
#   npx shopify app deploy --config ussea      (dev: --config ussea-dev)
#
# Server layout (set up 2026-11-16):
#   /srv/ussea-membership/app       the app (user ussea); app.old = fallback
#   /srv/ussea-membership/logs      app.log
#   /etc/ussea-membership.env       settings (root:ussea 640)
#   /root/ussea-membership-secrets  db_password, data_key, job_secret
#   ussea-membership.service        systemd; applies migrations, then server.cjs
#                                   on 127.0.0.1:3100 behind nginx
# The package runs on MariaDB: prisma/ holds the MySQL schema and migrations.
set -euo pipefail

case "${1:-live}" in
  live) NAME=ussea-membership; HOSTNAME_=membership-app.ussea.us; PORT=3100 ;;
  dev) NAME=ussea-membership-dev; HOSTNAME_=membership-app-dev.ussea.us; PORT=3101 ;;
  *) echo "Unknown target $1 (live or dev)." >&2; exit 1 ;;
esac

SSH=(ssh -i ~/.ssh/demo_edtech_claude -o BatchMode=yes -o ConnectTimeout=30 root@187.124.213.192)

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

REMOTE=$(cat <<'EOF'
set -e
APP=/srv/$NAME
rm -rf $APP/app.new && mkdir -p $APP/app.new && tar -xf - -C $APP/app.new
chown -R ussea:ussea $APP/app.new
cd $APP/app.new
# postinstall generates the Prisma client for this server.
runuser -u ussea -- env HOME=$APP npm ci --omit=dev --no-audit --no-fund 2>&1 | tail -1
systemctl stop $NAME 2>/dev/null || true
rm -rf $APP/app.old
[ -d $APP/app ] && mv $APP/app $APP/app.old
mv $APP/app.new $APP/app
systemctl enable --now $NAME >/dev/null 2>&1
systemctl restart $NAME
for i in $(seq 1 20); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: $HOSTNAME_" http://127.0.0.1:$PORT/ || true)
  case "$CODE" in 2*|3*|4*) break ;; esac
  sleep 2
done
echo "app -> HTTP $CODE ($(systemctl is-active $NAME))"
case "$CODE" in 2*|3*|4*) ;; *) journalctl -u $NAME -n 20 --no-pager; exit 2 ;; esac
EOF
)

tar -cf - . | "${SSH[@]}" "NAME=$NAME HOSTNAME_=$HOSTNAME_ PORT=$PORT; $REMOTE"
echo "Deployed $SHA to https://$HOSTNAME_."

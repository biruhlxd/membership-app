#!/usr/bin/env bash
# Puts USSEA's email look and per-plan welcome emails (emails.json, carried
# over from the Bridge's send_member_welcome_email) into USSEA Membership on
# the VPS. Plans are matched by their tag (ussea-basic, ussea-coach, ...);
# run it after the plans exist. Existing look and templates are replaced, so
# re-running is safe. Run from the project folder in Git Bash:
#   bash scripts/ussea/apply-emails.sh <shop>.myshopify.com        live app
#   bash scripts/ussea/apply-emails.sh <shop>.myshopify.com dev    dev app
set -euo pipefail

SHOP="${1:?usage: apply-emails.sh <shop>.myshopify.com [dev]}"
NAME=ussea-membership
[ "${2:-}" = "dev" ] && NAME=ussea-membership-dev
SSH=(ssh -i ~/.ssh/demo_edtech_claude -o BatchMode=yes -o ConnectTimeout=30 root@187.124.213.192)
JSON=$(cat "$(dirname "$0")/emails.json")

"${SSH[@]}" "cd /srv/$NAME/app && runuser -u ussea -- env SHOP='$SHOP' node --env-file=/etc/$NAME.env -e '
const { PrismaClient } = require(\"@prisma/client\");
const preset = JSON.parse(require(\"fs\").readFileSync(0, \"utf8\"));
const prisma = new PrismaClient();
const shop = process.env.SHOP;
(async () => {
  await prisma.emailLook.upsert({ where: { shop }, create: { shop, ...preset.look }, update: preset.look });
  const plans = await prisma.membershipPlan.findMany({ where: { shop }, select: { id: true, name: true, tag: true } });
  for (const [tag, t] of Object.entries(preset.welcomeByTag)) {
    const plan = plans.find((p) => p.tag === tag);
    if (!plan) { console.log(\"no plan with tag \" + tag + \": skipped\"); continue; }
    const data = { enabled: true, subject: t.subject, html: t.html };
    await prisma.emailTemplate.upsert({
      where: { shop_kind_planId: { shop, kind: \"WELCOME\", planId: plan.id } },
      create: { shop, kind: \"WELCOME\", planId: plan.id, ...data },
      update: data,
    });
    console.log(\"welcome for \" + plan.name + \" (\" + tag + \"): set\");
  }
  await prisma.\$disconnect();
})();
'" <<<"$JSON"

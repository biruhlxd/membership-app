// Creates USSEA's membership plans on a store with the app's own createPlan
// (the Plans page's code), from the offline session. Bundled and run on the
// VPS by create-plans.sh; plans already there (same tag) are skipped.
import prisma from "../../app/db.server";
import { createPlan } from "../../app/membership/plans.server";
import type { PlanInput } from "../../app/membership/plan";

const shop = process.env.SHOP!;
const plans: PlanInput[] = JSON.parse(process.env.PLANS!);

async function main() {
  const session = await prisma.session.findFirstOrThrow({ where: { shop, isOnline: false } });
  const admin = {
    graphql: (query: string, options?: { variables?: Record<string, unknown> }) =>
      fetch(`https://${shop}/admin/api/2026-10/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": session.accessToken },
        body: JSON.stringify({ query, variables: options?.variables }),
      }),
  };
  for (const plan of plans) {
    if (await prisma.membershipPlan.findFirst({ where: { shop, tag: plan.tag } })) {
      console.log(`${plan.name}: already there, skipped`);
      continue;
    }
    const result = await createPlan(admin, shop, plan);
    console.log(`${plan.name}: ${JSON.stringify(result)}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

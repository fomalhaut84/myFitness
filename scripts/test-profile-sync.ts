import "dotenv/config";
import { withReauth } from "../src/lib/garmin/client";
import { syncUserProfile } from "../src/lib/garmin/fetchers/user-profile";
import prisma from "../src/lib/prisma";

async function main() {
  await prisma.userProfile.upsert({
    where: { singleton: true },
    update: {},
    create: { singleton: true, name: "사용자" },
  });

  const result = await withReauth((c) =>
    syncUserProfile(c, new Date(), new Date())
  );
  console.log("synced:", result);

  const profile = await prisma.userProfile.findFirst();
  console.log("profile:", JSON.stringify(profile, null, 2));

  const history = await prisma.metricChange.findMany({
    orderBy: { changedAt: "desc" },
  });
  console.log(`\nhistory: ${history.length} rows`);
  for (const h of history.slice(0, 10)) {
    console.log(
      `  ${h.field}: ${h.oldValue} → ${h.newValue} | ${h.source} ${h.reason}`
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

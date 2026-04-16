/**
 * M4-5: 기존 Activity에 대해 intensity 필드 backfill.
 *
 * 실행: npx tsx scripts/backfill-intensity.ts
 */
import "dotenv/config";
import prisma from "../src/lib/prisma";
import { computeIntensityFromRawData } from "../src/lib/fitness/intensity";

/**
 * 옵션:
 *   --force: 이미 분류된 활동도 재분류 (기본: 이미 값 있으면 skip)
 */
async function main() {
  const force = process.argv.includes("--force");
  const profile = await prisma.userProfile.findFirst();
  const lthr = profile?.lthr ?? null;
  console.log(
    `LTHR(실측): ${lthr ?? "없음 (분포 기반 분류만 사용)"} | force=${force}`
  );

  const activities = await prisma.activity.findMany({
    select: {
      id: true,
      garminId: true,
      avgHR: true,
      rawData: true,
      name: true,
      intensityLabel: true,
    },
    orderBy: { startTime: "desc" },
  });

  console.log(`총 ${activities.length}개 활동 처리 시작...\n`);

  let withData = 0;
  let skipped = 0;
  let alreadyClassified = 0;

  for (const a of activities) {
    if (!force && a.intensityLabel !== null) {
      alreadyClassified++;
      continue;
    }

    const intensity = computeIntensityFromRawData({
      rawData: a.rawData as Record<string, unknown> | null,
      avgHR: a.avgHR,
      lthr,
    });

    if (!intensity) {
      skipped++;
      continue;
    }

    await prisma.activity.update({
      where: { id: a.id },
      data: {
        zoneDistribution: intensity.zoneDistribution as unknown as object,
        estimatedZone: intensity.estimatedZone,
        intensityScore: intensity.intensityScore,
        intensityLabel: intensity.intensityLabel,
      },
    });
    withData++;

    console.log(
      `  ✅ ${a.name} (${a.garminId}) → Zone ${intensity.estimatedZone}, ` +
        `${intensity.intensityLabel}, score ${intensity.intensityScore}`
    );
  }

  console.log(
    `\n완료: 총 ${activities.length}개 중 ${withData}개 분류, ` +
      `${alreadyClassified}개 기존 분류(skip), ${skipped}개 skip(분포 데이터 없음)`
  );
}

main()
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

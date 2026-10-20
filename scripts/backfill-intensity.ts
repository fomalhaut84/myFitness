/**
 * M4-5 · #570: Activity 강도 필드 backfill.
 *  - 심박 기준: 값이 없는 활동만 분류 (--force: 이미 분류된 활동도 재분류)
 *  - 러닝 파워 기준: 파워 컬럼이 비어 있는 러닝 활동만 채움 (fillMissingPowerIntensity)
 * 프로필 강도 기준 설정은 저장 값을 바꾸지 않는다 — 읽을 때 고른다.
 *
 * 실행: npx tsx scripts/backfill-intensity.ts [--force]
 */
import "dotenv/config";
import prisma from "../src/lib/prisma";
import { computeIntensityFromRawData } from "../src/lib/fitness/intensity";
import { fillMissingPowerIntensity } from "../src/lib/fitness/power-intensity-fill";

async function backfillHeartRate(force: boolean): Promise<void> {
  const profile = await prisma.userProfile.findFirst();
  const lthr = profile?.lthr ?? null;
  console.log(`[심박] LTHR(실측): ${lthr ?? "없음 (분포 기반 분류만 사용)"} | force=${force}`);

  const activities = await prisma.activity.findMany({
    select: { id: true, avgHR: true, rawData: true, intensityLabel: true },
    orderBy: { startTime: "desc" },
  });

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
  }
  console.log(
    `[심박] 총 ${activities.length}개 중 ${withData}개 분류, ${alreadyClassified}개 기존 분류(skip), ${skipped}개 skip(분포 데이터 없음)`
  );
}

async function main() {
  await backfillHeartRate(process.argv.includes("--force"));
  const { scanned, filled } = await fillMissingPowerIntensity();
  console.log(`[파워] 대상 ${scanned}개 중 ${filled}개 채움`);
}

main()
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

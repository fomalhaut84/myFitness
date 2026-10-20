/**
 * M4-5 · #570: 전체 Activity 강도 필드를 현재 프로필 기준 (심박 / 파워 / 자동) 으로 재계산.
 * 바뀐 행만 update 한다 (반복 실행해도 안전). 이전 --force 옵션은 이 동작에 포함됐다.
 *
 * 실행: npx tsx scripts/backfill-intensity.ts
 */
import "dotenv/config";
import prisma from "../src/lib/prisma";
import { recomputeAllIntensity } from "../src/lib/fitness/recompute-intensity";

async function main() {
  const profile = await prisma.userProfile.findFirst({
    select: { lthr: true, thresholdPower: true, intensityBasis: true },
  });
  console.log(
    `기준: ${profile?.intensityBasis ?? "hr"} | LTHR: ${profile?.lthr ?? "없음"} | 역치파워: ${profile?.thresholdPower ?? "없음"}`
  );
  const { total, updated } = await recomputeAllIntensity();
  console.log(`완료: 총 ${total}개 중 ${updated}개 갱신`);
}

main()
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

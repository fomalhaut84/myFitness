/**
 * #383: 워치 미착용 기간의 빈 DailySummary / HeartRateRecord stub 행 정리.
 *
 *   npx tsx scripts/cleanup-stub-days.ts            # dry-run (기본) — 대상 건수·날짜 범위만 출력
 *   npx tsx scripts/cleanup-stub-days.ts --apply    # 실제 삭제
 *
 * 조건은 src/lib/garmin/empty-day.ts 의 where 빌더 (fetcher 의 skip 조건과 같은 정의):
 * - DailySummary: steps · restingHR · totalCalories · bodyBatteryHigh 전부 null/0 **그리고** estimatedIntakeCalories 없음
 *   (식단을 기록한 날은 칼로리 밸런스 이력이라 보호).
 * - HeartRateRecord: restingHR · avgHR · maxHR · minHR · hrvStatus 전부 null.
 *
 * 프로덕션에서 1회 실행 (v2.28.0 backfill 로 생긴 2019-06 ~ 2020-06 stub). 이후엔 fetcher 가 만들지 않는다.
 */
import "dotenv/config";
import prisma from "../src/lib/prisma";
import { emptyDailySummaryWhere, emptyHeartRateWhere } from "../src/lib/garmin/empty-day";
import { ymdKST } from "../src/lib/garmin/utils";

function fmtRange(min: Date | null | undefined, max: Date | null | undefined): string {
  return min && max ? `${ymdKST(min)} ~ ${ymdKST(max)}` : "(없음)";
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const unknown = process.argv.slice(2).filter((a) => a !== "--apply");
  if (unknown.length > 0) {
    throw new Error(`알 수 없는 인자: ${unknown.join(" ")} (지원: --apply)`);
  }

  const dailyWhere = emptyDailySummaryWhere();
  const hrWhere = emptyHeartRateWhere();

  const [daily, hr, dailyTotal, hrTotal] = await Promise.all([
    prisma.dailySummary.aggregate({ where: dailyWhere, _count: { _all: true }, _min: { date: true }, _max: { date: true } }),
    prisma.heartRateRecord.aggregate({ where: hrWhere, _count: { _all: true }, _min: { date: true }, _max: { date: true } }),
    prisma.dailySummary.count(),
    prisma.heartRateRecord.count(),
  ]);

  console.log(`cleanup-stub-days ${apply ? "[apply]" : "[dry-run]"}`);
  console.log(`  DailySummary    : 대상 ${daily._count._all} / 전체 ${dailyTotal} · 날짜 ${fmtRange(daily._min.date, daily._max.date)}`);
  console.log(`  HeartRateRecord : 대상 ${hr._count._all} / 전체 ${hrTotal} · 날짜 ${fmtRange(hr._min.date, hr._max.date)}`);

  if (!apply) {
    console.log("\n삭제하지 않았습니다. 실제 삭제는 --apply 로 실행하세요.");
    return;
  }

  // 두 테이블을 한 트랜잭션으로 — 하나만 지워진 채 실패하면 coverage 가 반쪽으로 남는다.
  const [d, h] = await prisma.$transaction([
    prisma.dailySummary.deleteMany({ where: dailyWhere }),
    prisma.heartRateRecord.deleteMany({ where: hrWhere }),
  ]);
  console.log(`\n삭제 완료: DailySummary ${d.count}건 · HeartRateRecord ${h.count}건`);

  const [dailyAfter, hrAfter] = await Promise.all([
    prisma.dailySummary.aggregate({ _min: { date: true } }),
    prisma.heartRateRecord.aggregate({ _min: { date: true } }),
  ]);
  console.log(`정리 후 최초 기록: DailySummary ${dailyAfter._min.date ? ymdKST(dailyAfter._min.date) : "(없음)"} · HeartRateRecord ${hrAfter._min.date ? ymdKST(hrAfter._min.date) : "(없음)"}`);
}

main()
  .catch((error) => {
    console.error("cleanup-stub-days 실패:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

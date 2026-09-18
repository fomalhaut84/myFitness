/**
 * #383: 워치 미착용 기간의 빈 DailySummary / HeartRateRecord stub 행 정리.
 *
 *   npx tsx scripts/cleanup-stub-days.ts [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]            # dry-run (기본)
 *   npx tsx scripts/cleanup-stub-days.ts --from=2019-06-01 --to=2020-06-30 --apply        # 실제 삭제
 *
 * 삭제 조건은 src/lib/garmin/empty-day.ts 의 where 빌더 — fetcher 의 skip 조건(핵심 4개)보다 **엄격**하다
 * (사전 리뷰 major 2: 삭제는 되돌릴 수 없으므로 나머지 지표 컬럼과 칼로리 밸런스까지 전부 null 인 행만).
 * - DailySummary: steps · restingHR · totalCalories · bodyBatteryHigh 전부 null/0 + 나머지 지표·밸런스 컬럼 전부 null
 * - HeartRateRecord: restingHR · avgHR · maxHR · minHR · hrvStatus · hrvBaseline 전부 null
 * dry-run 은 "핵심 4개는 비었지만 다른 지표가 있는 행" 도 따로 센다 — 0 이 아니면 삭제 대상에서 빠진 행이 있다는 뜻이니 확인.
 * --from/--to (KST 달력, 포함) 로 범위를 못박는 것을 권장 (스펙 §4).
 *
 * 프로덕션에서 1회 실행 (v2.28.0 backfill 로 생긴 2019-06 ~ 2020-06 stub). 이후엔 fetcher 가 만들지 않는다.
 */
import "dotenv/config";
import prisma from "../src/lib/prisma";
import {
  coreEmptyDailySummaryWhere,
  emptyDailySummaryWhere,
  emptyHeartRateWhere,
} from "../src/lib/garmin/empty-day";
import { ymdKST } from "../src/lib/garmin/utils";

const DAY_MS = 24 * 60 * 60 * 1000;

function fmtRange(min: Date | null | undefined, max: Date | null | undefined): string {
  return min && max ? `${ymdKST(min)} ~ ${ymdKST(max)}` : "(없음)";
}

function parseKST(ymd: string, flag: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    throw new Error(`${flag}: YYYY-MM-DD 형식이어야 합니다 (받은 값: ${ymd})`);
  }
  const d = new Date(`${ymd}T00:00:00+09:00`);
  if (Number.isNaN(d.getTime()) || ymdKST(d) !== ymd) {
    throw new Error(`${flag}: 유효한 날짜가 아닙니다 (받은 값: ${ymd})`);
  }
  return d;
}

/** `--from=..` `--to=..` `--apply` 만 허용. 나머지는 오류. */
function parseArgs(argv: readonly string[]): { apply: boolean; from?: Date; to?: Date } {
  const result: { apply: boolean; from?: Date; to?: Date } = { apply: false };
  for (const arg of argv) {
    if (arg === "--apply") result.apply = true;
    else if (arg.startsWith("--from=")) result.from = parseKST(arg.slice(7), "--from");
    else if (arg.startsWith("--to=")) result.to = parseKST(arg.slice(5), "--to");
    else throw new Error(`알 수 없는 인자: ${arg} (지원: --from=YYYY-MM-DD --to=YYYY-MM-DD --apply)`);
  }
  if (result.from && result.to && result.from.getTime() > result.to.getTime()) {
    throw new Error("--from 이 --to 보다 늦습니다");
  }
  return result;
}

/** 날짜 범위 where (KST 달력, 양끝 포함 → until 은 to 다음 자정 exclusive). */
function dateWhere(from?: Date, to?: Date) {
  if (!from && !to) return {};
  return {
    date: {
      ...(from ? { gte: from } : {}),
      ...(to ? { lt: new Date(to.getTime() + DAY_MS) } : {}),
    },
  };
}

async function main(): Promise<void> {
  const { apply, from, to } = parseArgs(process.argv.slice(2));
  const range = dateWhere(from, to);
  const dailyWhere = { AND: [emptyDailySummaryWhere(), range] };
  const hrWhere = { AND: [emptyHeartRateWhere(), range] };
  // 핵심 4개는 비었지만 다른 지표/밸런스가 남아 있는 행 = 삭제 조건에서 빠진 행 (진단)
  const partialWhere = { AND: [coreEmptyDailySummaryWhere(), { NOT: emptyDailySummaryWhere() }, range] };

  // Codex P2 (PR #387 3회차): 표본은 20건으로 자르되 총건수는 별도 count — 경고가 "정확히 20건" 으로 오도되지 않게.
  const [daily, hr, partial, partialCount, dailyTotal, hrTotal] = await Promise.all([
    prisma.dailySummary.aggregate({ where: dailyWhere, _count: { _all: true }, _min: { date: true }, _max: { date: true } }),
    prisma.heartRateRecord.aggregate({ where: hrWhere, _count: { _all: true }, _min: { date: true }, _max: { date: true } }),
    prisma.dailySummary.findMany({ where: partialWhere, select: { date: true }, orderBy: { date: "asc" }, take: 20 }),
    prisma.dailySummary.count({ where: partialWhere }),
    prisma.dailySummary.count({ where: range }),
    prisma.heartRateRecord.count({ where: range }),
  ]);

  const rangeLabel = from || to ? ` · 범위 ${from ? ymdKST(from) : "…"} ~ ${to ? ymdKST(to) : "…"}` : " · 범위 전체";
  console.log(`cleanup-stub-days ${apply ? "[apply]" : "[dry-run]"}${rangeLabel}`);
  console.log(`  DailySummary    : 삭제 대상 ${daily._count._all} / ${dailyTotal} · 날짜 ${fmtRange(daily._min.date, daily._max.date)}`);
  console.log(`  HeartRateRecord : 삭제 대상 ${hr._count._all} / ${hrTotal} · 날짜 ${fmtRange(hr._min.date, hr._max.date)}`);
  if (partialCount > 0) {
    console.warn(
      `  ⚠️ 핵심 지표는 비었지만 다른 지표/밸런스가 있는 DailySummary ${partialCount}건은 삭제하지 않습니다 (앞 ${partial.length}건 표시): ` +
        partial.map((r) => ymdKST(r.date)).join(", "),
    );
  }

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

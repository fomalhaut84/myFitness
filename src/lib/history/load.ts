/**
 * #393 (M15-1): Prisma 조회 → 지표별 일별 포인트. 소스별로 **한 번씩만** 조회하고 (같은 소스의 지표는
 * select 를 합친다), rawData 는 절대 읽지 않는다. raw query 없이 컬럼 select + JS 접기 (m15-overview D5).
 *
 * 활동은 startTime 의 KST 날짜로 접는다 (하루 2회 러닝 = km 합 · 횟수 2). 러닝 판정은 `isRunningType`
 * 을 JS 에서 적용한다 — `contains: "run"` 필터는 RUNNING_TYPES 와 어긋날 수 있다.
 */
import prisma from "@/lib/prisma";
import { ymdKST } from "@/lib/garmin/utils";
import { isRunningType } from "@/lib/activity/running-types";
import { kstDayRange, kstInstant } from "./buckets";
import { getHistoryMetric, type HistoryMetricDef, type HistoryMetricId } from "./metrics";
import type { DailyPoint } from "./rollup";

export type DailyPointsByMetric = Partial<Record<HistoryMetricId, DailyPoint[]>>;

interface Range {
  /** inclusive KST 자정 */
  start: Date;
  /** exclusive */
  end: Date;
}

/** date = KST 자정 instant 인 일별 모델 (DailySummary · SleepRecord · BodyComposition · FitnessMetricDaily) */
type DateKeyedSource = Exclude<HistoryMetricDef["source"], "activity">;
type DateKeyedDef = Extract<HistoryMetricDef, { source: DateKeyedSource }>;
type DateRow = { date: Date } & Record<string, unknown>;

function toRange(fromYmd: string, toYmd: string): Range {
  return { start: kstInstant(fromYmd), end: kstDayRange(toYmd).end };
}

/** 일별 모델 행 → 필드별 포인트. null 은 결측이라 포인트를 만들지 않는다. */
function pointsFromRows(rows: readonly DateRow[], defs: readonly DateKeyedDef[]): DailyPointsByMetric {
  return Object.fromEntries(
    defs.map((def) => [
      def.id,
      rows.flatMap((row) => {
        const v = row[def.field];
        return typeof v === "number" ? [{ ymd: ymdKST(row.date), value: v }] : [];
      }),
    ]),
  );
}

/**
 * 지표 목록으로 select 를 동적으로 만들기 때문에 Prisma 의 정적 반환 타입을 쓸 수 없다.
 * select 에 넣은 컬럼은 레지스트리의 `NumericKey<Model>` 로 제한돼 있어 행 모양은 `{ date } & 숫자|null` 이다.
 */
async function findDateKeyed(source: DateKeyedSource, range: Range, fields: readonly string[]): Promise<DateRow[]> {
  const where = { date: { gte: range.start, lt: range.end } };
  const select = Object.fromEntries([["date", true], ...fields.map((f) => [f, true])]) as Record<string, true>;
  switch (source) {
    case "daily":
      return (await prisma.dailySummary.findMany({ where, select })) as unknown as DateRow[];
    case "sleep":
      return (await prisma.sleepRecord.findMany({ where, select })) as unknown as DateRow[];
    case "body":
      return (await prisma.bodyComposition.findMany({ where, select })) as unknown as DateRow[];
    case "fitness":
      return (await prisma.fitnessMetricDaily.findMany({ where, select })) as unknown as DateRow[];
  }
}

async function loadDateKeyed(source: DateKeyedSource, range: Range, defs: readonly HistoryMetricDef[]): Promise<DailyPointsByMetric> {
  const fieldDefs = defs.flatMap((d): DateKeyedDef[] => (d.source === source ? [d] : []));
  const rows = await findDateKeyed(source, range, [...new Set(fieldDefs.map((d) => d.field))]);
  return pointsFromRows(rows, fieldDefs);
}

export interface ActivityRow {
  startTime: Date;
  activityType: string;
  distance: number | null;
  duration: number;
  /** #442: 종료 후 2분 HRR (`Activity.hrr2`). 옵셔널 — 기존 호출자 (kpi 등) 는 없음 */
  hrr2?: number | null;
}

/**
 * 러닝 활동 행 → 지표별 일별 포인트. 순수 (테스트 대상).
 * `duration` 은 **거리가 있는 러닝만** 센다 — 평균 페이스 KPI 가 `시간 합 / 거리 합` 이라 두 합계가 같은 활동 집합을
 * 덮어야 한다. 거리 없는 러닝 (GPS 없는 트레드밀 등) 의 시간이 섞이면 페이스가 실제보다 느리게 나온다 (PR #402 Codex P2).
 */
export function activityPoints(rows: readonly ActivityRow[], defs: readonly HistoryMetricDef[]): DailyPointsByMetric {
  const running = rows.filter((r) => isRunningType(r.activityType));
  return Object.fromEntries(
    defs.flatMap((def) => {
      if (def.source !== "activity") return [];
      const points: DailyPoint[] = running.flatMap((r) => {
        const ymd = ymdKST(r.startTime);
        if (def.kind === "count") return [{ ymd, value: 1 }];
        // #442: 값 있는 러닝만 점 (null = 하루 심박 없음 · 결측). 음수 (종료 뒤 상승) 도 값이다 — 거르지 않는다
        if (def.kind === "hrr2") return typeof r.hrr2 === "number" ? [{ ymd, value: r.hrr2 }] : [];
        const hasDistance = typeof r.distance === "number" && r.distance > 0;
        if (def.kind === "duration") return hasDistance ? [{ ymd, value: r.duration }] : [];
        return typeof r.distance === "number" ? [{ ymd, value: r.distance / 1000 }] : [];
      });
      return [[def.id, points]];
    }),
  );
}

async function loadActivity(range: Range, defs: readonly HistoryMetricDef[]): Promise<DailyPointsByMetric> {
  const rows = await prisma.activity.findMany({
    where: { startTime: { gte: range.start, lt: range.end } },
    select: { startTime: true, activityType: true, distance: true, duration: true, hrr2: true },
  });
  return activityPoints(rows, defs);
}

/** 요청 지표의 소스만 골라 병렬 조회. 반환은 지표 id → 일별 포인트 (요청 지표 전부 키 존재). */
export async function loadDailyPoints(
  fromYmd: string,
  toYmd: string,
  metricIds: readonly HistoryMetricId[],
): Promise<DailyPointsByMetric> {
  const range = toRange(fromYmd, toYmd);
  const defs = metricIds.map(getHistoryMetric);
  const sources = [...new Set(defs.map((d) => d.source))];
  const parts = await Promise.all(
    sources.map((s) => (s === "activity" ? loadActivity(range, defs) : loadDateKeyed(s, range, defs))),
  );
  return parts.reduce<DailyPointsByMetric>((acc, part) => ({ ...acc, ...part }), {});
}

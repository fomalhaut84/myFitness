/**
 * #396 (M15-4): 데이터 커버리지 — 소스별 최초 · 최신 · 건수. 집계는 MCP `get_data_coverage` (#377) 에서 옮겨 와
 * 도구와 `/history` 띠가 같은 숫자를 본다. 띠 shape (`buildCoverageStrip`) 은 순수.
 */
import prisma from "@/lib/prisma";
import { ymdKST } from "@/lib/garmin/utils";
import { diffDaysYmd } from "./buckets";

export interface CoverageRange {
  oldest: string | null;
  newest: string | null;
  count: number;
}

export interface CoverageRanges {
  activities: CoverageRange & { running: CoverageRange };
  daily_stats: CoverageRange;
  sleep: CoverageRange;
  heart_rate: CoverageRange;
  body_composition: CoverageRange;
  blood_pressure: CoverageRange;
  fitness_metrics: CoverageRange;
  /** #396: 야간 HRV 는 2026-04 부터만 있다 (memory `project_hrv_data_start`) — 띠에서 범위가 다른 소스 */
  hrv: CoverageRange;
  food_log: CoverageRange;
}

function toRange(min: Date | null | undefined, max: Date | null | undefined, count: number): CoverageRange {
  return { oldest: min ? ymdKST(min) : null, newest: max ? ymdKST(max) : null, count };
}

const DATE_AGG = { _min: { date: true }, _max: { date: true }, _count: { _all: true } } as const;

export async function getCoverageRanges(): Promise<CoverageRanges> {
  const [activity, running, daily, sleep, hr, body, bp, fm, hrv, food] = await Promise.all([
    prisma.activity.aggregate({ _min: { startTime: true }, _max: { startTime: true }, _count: { _all: true } }),
    prisma.activity.aggregate({
      where: { activityType: { contains: "running" } },
      _min: { startTime: true },
      _max: { startTime: true },
      _count: { _all: true },
    }),
    prisma.dailySummary.aggregate(DATE_AGG),
    prisma.sleepRecord.aggregate(DATE_AGG),
    prisma.heartRateRecord.aggregate(DATE_AGG),
    prisma.bodyComposition.aggregate(DATE_AGG),
    prisma.bloodPressure.aggregate(DATE_AGG),
    prisma.fitnessMetricDaily.aggregate(DATE_AGG),
    prisma.sleepRecord.aggregate({ where: { hrvOvernight: { not: null } }, ...DATE_AGG }),
    prisma.foodLog.aggregate(DATE_AGG),
  ]);
  return {
    activities: {
      ...toRange(activity._min.startTime, activity._max.startTime, activity._count._all),
      running: toRange(running._min.startTime, running._max.startTime, running._count._all),
    },
    daily_stats: toRange(daily._min.date, daily._max.date, daily._count._all),
    sleep: toRange(sleep._min.date, sleep._max.date, sleep._count._all),
    heart_rate: toRange(hr._min.date, hr._max.date, hr._count._all),
    body_composition: toRange(body._min.date, body._max.date, body._count._all),
    blood_pressure: toRange(bp._min.date, bp._max.date, bp._count._all),
    fitness_metrics: toRange(fm._min.date, fm._max.date, fm._count._all),
    hrv: toRange(hrv._min.date, hrv._max.date, hrv._count._all),
    food_log: toRange(food._min.date, food._max.date, food._count._all),
  };
}

export type CoverageSourceId = "activities" | "daily_stats" | "sleep" | "body_composition" | "fitness_metrics" | "hrv" | "blood_pressure" | "food_log";

export interface CoverageStripRow {
  id: CoverageSourceId;
  label: string;
  oldest: string | null;
  newest: string | null;
  count: number;
  unit: "건" | "일";
  /** 축 (하한 → 오늘) 위 위치, 0~100. 기록이 없으면 null */
  startPct: number | null;
  endPct: number | null;
  /** 활동만 — 러닝 건수 */
  note: string | null;
}

export interface CoverageStrip {
  from: string;
  to: string;
  rows: CoverageStripRow[];
}

/** 띠에 보이는 소스와 순서. 심박 (`heart_rate`) 은 일간 요약과 범위가 같아 뺀다. 혈압 · 식단은 수동 입력이라 범위가 다르다 — 그래서 넣는다. */
const STRIP_SOURCES: readonly { id: CoverageSourceId; label: string; unit: "건" | "일" }[] = [
  { id: "activities", label: "활동", unit: "건" },
  { id: "daily_stats", label: "일간 요약", unit: "일" },
  { id: "sleep", label: "수면", unit: "일" },
  { id: "body_composition", label: "체중", unit: "건" },
  { id: "fitness_metrics", label: "피트니스 지표", unit: "일" },
  { id: "hrv", label: "야간 HRV", unit: "일" },
  { id: "blood_pressure", label: "혈압", unit: "건" },
  { id: "food_log", label: "식단", unit: "일" },
];

function pct(ymd: string, from: string, span: number): number {
  if (span <= 0) return 0;
  const days = diffDaysYmd(from, ymd);
  return Math.min(100, Math.max(0, (days / span) * 100));
}

/** 하한 → 오늘 축 기준 위치. 하한 이전 기록 (심박 · 혈압 · 식단은 하한 계산에 안 들어간다) 은 0 으로 클램프. */
export function buildCoverageStrip(ranges: CoverageRanges, ctx: { lowerBound: string; today: string }): CoverageStrip {
  const span = diffDaysYmd(ctx.lowerBound, ctx.today);
  const rows = STRIP_SOURCES.map(({ id, label, unit }): CoverageStripRow => {
    const range = ranges[id];
    const has = range.oldest !== null && range.newest !== null && range.count > 0;
    return {
      id,
      label,
      oldest: range.oldest,
      newest: range.newest,
      count: range.count,
      unit,
      startPct: has ? pct(range.oldest as string, ctx.lowerBound, span) : null,
      endPct: has ? pct(range.newest as string, ctx.lowerBound, span) : null,
      note: id === "activities" ? `러닝 ${ranges.activities.running.count.toLocaleString("ko-KR")}` : null,
    };
  });
  return { from: ctx.lowerBound, to: ctx.today, rows };
}

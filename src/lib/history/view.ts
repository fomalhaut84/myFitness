/**
 * #394 (M15-2): `/history` 연·월 뷰 데이터 조립 (서버 전용). 값은 전부 `getCachedHistorySummary` 경유 —
 * 페이지가 각자 reduce 하지 않는다 (m15-overview D4).
 *
 * KPI 는 그 기간을 **한 버킷** 으로 롤업한 summary 에서 만든다. 월 버킷을 다시 평균 내면 평균의 평균이 된다.
 */
import { getCachedHistorySummary } from "./cache";
import type { HistoryGranularity } from "./buckets";
import { buildIntensityScale, type IntensityLevel } from "./intensity";
import { buildHistoryKpis, HISTORY_KPI_METRIC_IDS, type HistoryKpi } from "./kpi";
import {
  DEFAULT_HISTORY_METRIC_ID,
  getHistoryMetric,
  isHistoryMetricId,
  type HistoryMetricDef,
  type HistoryMetricId,
} from "./metrics";
import { addMonthsYm, daysInYm, formatYm, monthCells } from "./month-cells";
import type { SummaryBucket } from "./summary";

export interface HistoryViewContext {
  today: string;
  lowerBound: string;
}

export type HistoryCellState = "value" | "zero" | "missing" | "off";

export interface HistoryDayCell {
  ymd: string;
  day: number;
  state: HistoryCellState;
  value: number | null;
  level: IntensityLevel | null;
}

export interface HistoryMonthSummary {
  ym: string;
  month: number;
  /** 범위 안에 하루라도 걸치는 달 (링크 가능) */
  live: boolean;
  value: number | null;
  coveredDays: number;
  totalDays: number;
  leadingBlanks: number;
  cells: HistoryDayCell[];
}

/** `?metric=` — 미등록 · 비노출 id 는 기본값 (페이지 URL 이라 400 이 아니라 fallback). */
export function resolveHistoryMetric(raw: string | string[] | undefined): HistoryMetricId {
  const id = Array.isArray(raw) ? raw[0] : raw;
  return isHistoryMetricId(id) && getHistoryMetric(id).selectable ? id : DEFAULT_HISTORY_METRIC_ID;
}

function clampRange(from: string, to: string, ctx: HistoryViewContext): { from: string; to: string } | null {
  const clampedFrom = from < ctx.lowerBound ? ctx.lowerBound : from;
  const clampedTo = to > ctx.today ? ctx.today : to;
  return clampedFrom <= clampedTo ? { from: clampedFrom, to: clampedTo } : null;
}

async function loadBuckets(
  granularity: HistoryGranularity,
  range: { from: string; to: string },
  metrics: readonly HistoryMetricId[],
  ctx: HistoryViewContext,
): Promise<SummaryBucket[]> {
  const summary = await getCachedHistorySummary(
    { granularity, from: range.from, to: range.to, metrics: [...metrics], clampedFrom: false, clampedTo: false },
    ctx,
  );
  return summary.buckets;
}

function toCells(
  ym: string,
  dayValues: ReadonlyMap<string, number | null>,
  def: HistoryMetricDef,
  scale: (v: number) => IntensityLevel,
  ctx: HistoryViewContext,
): HistoryDayCell[] {
  return monthCells(ym).days.map((ymd, i) => {
    const day = i + 1;
    if (ymd < ctx.lowerBound || ymd > ctx.today) return { ymd, day, state: "off", value: null, level: null };
    const value = dayValues.get(ymd) ?? null;
    if (value === null) return { ymd, day, state: "missing", value: null, level: null };
    // 활동 없는 날은 진짜 0 (쉰 날) — 결측과 다르게 그린다
    if (def.missingAsZero && value === 0) return { ymd, day, state: "zero", value: 0, level: null };
    return { ymd, day, state: "value", value, level: scale(value) };
  });
}

function scaleFor(dayBuckets: readonly SummaryBucket[], def: HistoryMetricDef): (v: number) => IntensityLevel {
  const values = dayBuckets.flatMap((b) => {
    const v = b.values[def.id]?.value;
    return typeof v === "number" && !(def.missingAsZero && v === 0) ? [v] : [];
  });
  return buildIntensityScale(values, def.aggregate === "sum");
}

function dayValueMap(dayBuckets: readonly SummaryBucket[], id: HistoryMetricId): Map<string, number | null> {
  return new Map(dayBuckets.map((b) => [b.key, b.values[id]?.value ?? null]));
}

export interface HistoryYearView {
  metric: HistoryMetricDef;
  months: HistoryMonthSummary[];
  kpis: HistoryKpi[];
}

export async function loadHistoryYearView(year: number, metricId: HistoryMetricId, ctx: HistoryViewContext): Promise<HistoryYearView> {
  const def = getHistoryMetric(metricId);
  const range = clampRange(`${year}-01-01`, `${year}-12-31`, ctx);
  const [monthBuckets, dayBuckets, yearBuckets] = range
    ? await Promise.all([
        loadBuckets("month", range, [metricId], ctx),
        loadBuckets("day", range, [metricId], ctx),
        loadBuckets("year", range, HISTORY_KPI_METRIC_IDS, ctx),
      ])
    : [[], [], []];

  const scale = scaleFor(dayBuckets, def);
  const values = dayValueMap(dayBuckets, metricId);
  const monthByKey = new Map(monthBuckets.map((b) => [b.key, b]));

  const months = Array.from({ length: 12 }, (_, i): HistoryMonthSummary => {
    const ym = formatYm(year, i + 1);
    const bucket = monthByKey.get(ym);
    const live = `${ym}-01` <= ctx.today && `${addMonthsYm(ym, 1)}-01` > ctx.lowerBound;
    return {
      ym,
      month: i + 1,
      live,
      value: bucket?.values[metricId]?.value ?? null,
      coveredDays: bucket?.values[metricId]?.coveredDays ?? 0,
      totalDays: bucket?.totalDays ?? daysInYm(ym),
      leadingBlanks: monthCells(ym).leadingBlanks,
      cells: toCells(ym, values, def, scale, ctx),
    };
  });

  return { metric: def, months, kpis: buildHistoryKpis(yearBuckets[0]?.values ?? {}) };
}

export interface HistoryMonthView {
  metric: HistoryMetricDef;
  ym: string;
  leadingBlanks: number;
  cells: HistoryDayCell[];
  kpis: HistoryKpi[];
}

export async function loadHistoryMonthView(ym: string, metricId: HistoryMetricId, ctx: HistoryViewContext): Promise<HistoryMonthView> {
  const def = getHistoryMetric(metricId);
  const range = clampRange(`${ym}-01`, `${ym}-${String(daysInYm(ym)).padStart(2, "0")}`, ctx);
  const [dayBuckets, monthBuckets] = range
    ? await Promise.all([
        loadBuckets("day", range, [metricId], ctx),
        loadBuckets("month", range, HISTORY_KPI_METRIC_IDS, ctx),
      ])
    : [[], []];

  return {
    metric: def,
    ym,
    leadingBlanks: monthCells(ym).leadingBlanks,
    cells: toCells(ym, dayValueMap(dayBuckets, metricId), def, scaleFor(dayBuckets, def), ctx),
    kpis: buildHistoryKpis(monthBuckets[0]?.values ?? {}),
  };
}

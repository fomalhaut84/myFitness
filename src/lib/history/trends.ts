/**
 * #395 (M15-3): `/trends` view model. 순수 — summary 버킷 → 차트가 그대로 그릴 수 있는 배열.
 * 컴포넌트는 reduce 하지 않는다. 불완전한 데이터 세 가지를 여기서 판정한다:
 *
 * - **결측**: `value === null` → 선이 끊긴다.
 * - **저커버리지** (`lowCoverage`): 기록이 절반 미만인 버킷 → 흐리게. 3일치 평균이 한 달 평균처럼 읽히지 않게.
 * - **미완결** (`partial`): 달력 범위가 [하한, 오늘] 에 다 들어가지 않는 버킷 (이번 달 · 하한이 걸친 첫 달).
 *   합계형에서만 의미가 있다 — 9월 21일까지의 합계가 "적게 뛴 달" 로 읽히지 않게.
 */
import { addDaysYmd, type HistoryGranularity } from "./buckets";
import type { HistoryMetricDef } from "./metrics";
import { historyMonthPath, historyYearPath } from "./route-params";
import type { SummaryBucket } from "./summary";

export const LOW_COVERAGE_RATIO = 0.5;

export interface TrendsDataContext {
  today: string;
  lowerBound: string;
}

export interface TrendPoint {
  key: string;
  label: string;
  /** 연 경계 (축에 연도를 밝게 표시). 연 단위에서는 항상 false */
  yearStart: boolean;
  value: number | null;
  min: number | null;
  max: number | null;
  coveredDays: number;
  totalDays: number;
  lowCoverage: boolean;
  partial: boolean;
  /** `/history` 의 대응 레벨 */
  href: string;
}

function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/**
 * 체중은 원래 드물게 재는 값 (6년 372건) 이라 "절반 미만" 규칙을 적용하면 전부 흐려진다 → `body` 소스는 제외.
 * 활동 지표는 0 이 진짜 0 이라 커버리지 개념이 없다. 두 번째 예외가 생기면 레지스트리 필드로 승격.
 */
export function isLowCoverage(def: HistoryMetricDef, coveredDays: number, totalDays: number): boolean {
  if (def.missingAsZero || def.source === "body") return false;
  if (totalDays <= 0 || coveredDays <= 0) return false;
  return coveredDays / totalDays < LOW_COVERAGE_RATIO;
}

export function isPartialBucket(bucket: Pick<SummaryBucket, "start" | "end">, ctx: TrendsDataContext): boolean {
  return bucket.start < ctx.lowerBound || bucket.end > addDaysYmd(ctx.today, 1);
}

/** 축 라벨. 주 `3/11` · 월 `3월` · 연 `2024`. 연 경계 버킷은 차트가 연도로 바꿔 그린다. */
export function formatBucketLabel(key: string, granularity: HistoryGranularity): string {
  switch (granularity) {
    case "year":
      return key;
    case "month":
      return `${Number(key.slice(5, 7))}월`;
    case "week":
    case "day":
      return `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
  }
}

function bucketHref(bucket: SummaryBucket, granularity: HistoryGranularity): string {
  return granularity === "year" ? historyYearPath(Number(bucket.key)) : historyMonthPath(bucket.start.slice(0, 7));
}

export function toTrendPoints(
  buckets: readonly SummaryBucket[],
  def: HistoryMetricDef,
  granularity: HistoryGranularity,
  ctx: TrendsDataContext,
): TrendPoint[] {
  return buckets.map((bucket, i) => {
    const v = bucket.values[def.id];
    const coveredDays = v?.coveredDays ?? 0;
    const prev = buckets[i - 1];
    return {
      key: bucket.key,
      label: formatBucketLabel(bucket.key, granularity),
      yearStart: granularity !== "year" && prev !== undefined && prev.start.slice(0, 4) !== bucket.start.slice(0, 4),
      value: v?.value ?? null,
      min: v?.min ?? null,
      max: v?.max ?? null,
      coveredDays,
      totalDays: bucket.totalDays,
      lowCoverage: isLowCoverage(def, coveredDays, bucket.totalDays),
      partial: isPartialBucket(bucket, ctx),
      href: bucketHref(bucket, granularity),
    };
  });
}

/** 최고/최저 판독값에 쓸 수 있는 포인트 — 결측 · 저커버리지 · (합계형) 미완결 제외. */
function isComparable(point: TrendPoint, def: HistoryMetricDef): boolean {
  if (point.value === null || point.lowCoverage) return false;
  return !(def.aggregate === "sum" && point.partial);
}

export function summarizeSeries(
  points: readonly TrendPoint[],
  def: HistoryMetricDef,
): { best: TrendPoint | null; worst: TrendPoint | null } {
  const usable = points.filter((p) => isComparable(p, def));
  if (usable.length === 0) return { best: null, worst: null };
  return {
    best: usable.reduce((acc, p) => ((p.value as number) > (acc.value as number) ? p : acc)),
    worst: usable.reduce((acc, p) => ((p.value as number) < (acc.value as number) ? p : acc)),
  };
}

export interface YearMonthValue {
  value: number | null;
  coveredDays: number;
  totalDays: number;
  lowCoverage: boolean;
  partial: boolean;
}

export interface YearPivot {
  /** 오름차순 */
  years: number[];
  /** `cells[year][month - 1]` — 범위 밖 달은 null */
  cells: Record<number, (YearMonthValue | null)[]>;
}

/** 월 버킷 → 연도 × 12개월. 범위 (하한~오늘) 밖의 달은 null. */
export function pivotByYear(monthBuckets: readonly SummaryBucket[], def: HistoryMetricDef, ctx: TrendsDataContext): YearPivot {
  const cells: Record<number, (YearMonthValue | null)[]> = {};
  for (const bucket of monthBuckets) {
    const year = Number(bucket.key.slice(0, 4));
    const month = Number(bucket.key.slice(5, 7));
    const row = cells[year] ?? Array.from({ length: 12 }, () => null);
    const v = bucket.values[def.id];
    const coveredDays = v?.coveredDays ?? 0;
    row[month - 1] = {
      value: v?.value ?? null,
      coveredDays,
      totalDays: bucket.totalDays,
      lowCoverage: isLowCoverage(def, coveredDays, bucket.totalDays),
      partial: isPartialBucket(bucket, ctx),
    };
    cells[year] = row;
  }
  return { years: Object.keys(cells).map(Number).sort((a, b) => a - b), cells };
}

export interface SeasonalityMonth {
  month: number;
  /** 대표값. 기여한 해가 없으면 null */
  value: number | null;
  /** 대표값에 기여한 해 수 */
  years: number;
  /** 해마다의 값 (기여한 것만) */
  points: { year: number; value: number }[];
}

/**
 * 연도 무관 월별 대표값. 규칙은 지표의 집계 방식을 따른다:
 * sum → 완결 월들의 월 합계 **평균** · avg → `coveredDays` **가중 평균** · max → 최고 · last → 월 값 평균.
 * 결측 · 저커버리지 · (합계형) 미완결 월은 기여하지 않는다.
 */
export function seasonality(pivot: YearPivot, def: HistoryMetricDef): SeasonalityMonth[] {
  return Array.from({ length: 12 }, (_, i): SeasonalityMonth => {
    const used = pivot.years.flatMap((year) => {
      const cell = pivot.cells[year]?.[i];
      if (!cell || cell.value === null || cell.lowCoverage) return [];
      if (def.aggregate === "sum" && cell.partial) return [];
      return [{ year, value: cell.value, weight: cell.coveredDays }];
    });
    const points = used.map(({ year, value }) => ({ year, value }));
    if (used.length === 0) return { month: i + 1, value: null, years: 0, points };

    const values = used.map((u) => u.value);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const totalWeight = used.reduce((s, u) => s + u.weight, 0);
    const value =
      def.aggregate === "max"
        ? Math.max(...values)
        : def.aggregate === "avg" && totalWeight > 0
          ? used.reduce((s, u) => s + u.value * u.weight, 0) / totalWeight
          : mean;
    return { month: i + 1, value: roundTo(value, def.decimals), years: used.length, points };
  });
}

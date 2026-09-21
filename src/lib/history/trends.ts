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
  partial: PartialReason | null;
  /** `/history` 의 대응 레벨 */
  href: string;
}

function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/**
 * 활동 지표는 0 이 진짜 0 이라 커버리지 개념이 없고, `sparse` 지표 (체중 · 젖산역치 페이스) 는 기록 일수가 적은 것이
 * 정상이다 — 규칙을 적용하면 전부 흐려지고 YoY · 계절성 · 최고/최저에서 빠진다 (PR #407 Codex P2).
 */
export function isLowCoverage(def: HistoryMetricDef, coveredDays: number, totalDays: number): boolean {
  if (def.missingAsZero || def.sparse) return false;
  if (totalDays <= 0 || coveredDays <= 0) return false;
  return coveredDays / totalDays < LOW_COVERAGE_RATIO;
}

/**
 * 다 채워지지 않은 버킷의 이유. 둘은 화면 문구가 다르다 — 6년 전 달에 "진행 중" 이라고 쓰면 안 된다 (사전 리뷰 major 3).
 * - `current`: 오늘이 속한 버킷 (아직 끝나지 않음)
 * - `clipped`: 기록 시작일 (하한) 이 걸린 첫 버킷
 * 둘 다 해당하면 (데이터가 한 버킷 미만) `current`.
 *
 * `current` 는 "오늘이 속한 버킷" 이다 — 오늘이 버킷의 **마지막 날** 이어도 하루가 끝나지 않았으니 미완결이다
 * (9월 30일의 9월 합계는 아직 부분 합계 — PR #407 Codex P2). `end` 는 exclusive.
 */
export type PartialReason = "current" | "clipped";

export function partialReason(bucket: Pick<SummaryBucket, "start" | "end">, ctx: TrendsDataContext): PartialReason | null {
  if (bucket.start <= ctx.today && ctx.today < bucket.end) return "current";
  if (bucket.start < ctx.lowerBound) return "clipped";
  return null;
}

export const PARTIAL_LABELS: Record<PartialReason, string> = {
  current: "아직 끝나지 않음",
  clipped: "기록 시작일이 걸림",
};

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
  if (granularity === "year") return historyYearPath(Number(bucket.key));
  // 주 버킷은 월 경계를 걸칠 수 있다 — 주의 가운데 날 (목요일) 이 속한 달로 보낸다
  const anchor = granularity === "week" ? addDaysYmd(bucket.start, 3) : bucket.start;
  return historyMonthPath(anchor.slice(0, 7));
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
      partial: partialReason(bucket, ctx),
      href: bucketHref(bucket, granularity),
    };
  });
}

/** 최고/최저 판독값에 쓸 수 있는 포인트 — 결측 · 저커버리지 · (합계형) 미완결 제외. */
function isComparable(point: TrendPoint, def: HistoryMetricDef): boolean {
  if (point.value === null || point.lowCoverage) return false;
  return !(def.aggregate === "sum" && point.partial !== null);
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
  partial: PartialReason | null;
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
      partial: partialReason(bucket, ctx),
    };
    cells[year] = row;
  }
  return { years: Object.keys(cells).map(Number).sort((a, b) => a - b), cells };
}

export type YoyRow = { month: number } & Record<string, number | null>;

/**
 * YoY 차트 행. 연도마다 두 계열:
 * - `y{year}` 실선 — 완결되고 기록이 충분한 달
 * - `p{year}` 점선 — 다 채워지지 않은 달 (합계형만) 과 **그 앞뒤** 의 완결 달. 미완결 달이 시리즈의 끝 (이번 달) 이든
 *   처음 (기록 시작일이 걸린 달) 이든 이웃과 이어진다.
 */
export function buildYoyRows(pivot: YearPivot, def: Pick<HistoryMetricDef, "aggregate">): YoyRow[] {
  const isSum = def.aggregate === "sum";
  const usable = (c: YearMonthValue | null | undefined): c is YearMonthValue & { value: number } =>
    c != null && c.value !== null && !c.lowCoverage;
  const isPartial = (c: YearMonthValue | null | undefined) => isSum && usable(c) && c.partial !== null;

  return Array.from({ length: 12 }, (_, i) => {
    const row: YoyRow = { month: i + 1 };
    for (const year of pivot.years) {
      const cells = pivot.cells[year] ?? [];
      const cell = cells[i];
      const partial = isPartial(cell);
      const besidePartial = isPartial(cells[i - 1]) || isPartial(cells[i + 1]);
      row[`y${year}`] = usable(cell) && !partial ? cell.value : null;
      row[`p${year}`] = usable(cell) && (partial || besidePartial) ? cell.value : null;
    }
    return row;
  });
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
      if (def.aggregate === "sum" && cell.partial !== null) return [];
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

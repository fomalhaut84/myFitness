/**
 * #395 (M15-3): 임의 구간을 **한 덩어리** 로 롤업 — `/trends` 기간 비교 · 시계열 "기간 전체" 판독값.
 *
 * 월 버킷 값을 다시 평균 내면 평균의 평균이 된다 (#394 KPI 와 같은 원칙). 일별 포인트에서 직접 집계한다.
 * 집계 본체는 `rollup.ts` 의 `aggregatePoints` 를 공유한다.
 */
import { diffDaysYmd } from "./buckets";
import { loadDailyPoints, type DailyPointsByMetric } from "./load";
import { getHistoryMetric, type HistoryMetricId } from "./metrics";
import { aggregatePoints, type BucketValue } from "./rollup";

export interface HistoryRangeTotals {
  /** KST 달력일 (inclusive) */
  from: string;
  to: string;
  totalDays: number;
  values: Partial<Record<HistoryMetricId, BucketValue>>;
}

/** 순수: 이미 [from, to] 로 조회된 포인트 → 지표별 값. 범위 밖 포인트는 방어적으로 버린다. */
export function rangeTotalsFromPoints(
  points: DailyPointsByMetric,
  range: { from: string; to: string },
  metricIds: readonly HistoryMetricId[],
): HistoryRangeTotals {
  return {
    from: range.from,
    to: range.to,
    totalDays: Math.max(0, diffDaysYmd(range.from, range.to) + 1),
    values: Object.fromEntries(
      metricIds.map((id) => {
        const inRange = (points[id] ?? []).filter((p) => p.ymd >= range.from && p.ymd <= range.to);
        return [id, aggregatePoints(inRange, getHistoryMetric(id))];
      }),
    ),
  };
}

export type RangePointsLoader = typeof loadDailyPoints;

export async function getHistoryRangeTotals(
  range: { from: string; to: string },
  metricIds: readonly HistoryMetricId[],
  loader: RangePointsLoader = loadDailyPoints,
): Promise<HistoryRangeTotals> {
  if (range.from > range.to) return rangeTotalsFromPoints({}, range, metricIds);
  return rangeTotalsFromPoints(await loader(range.from, range.to, metricIds), range, metricIds);
}

/**
 * #393 (M15-1): 일별 포인트 → 버킷 집계. 순수 함수 · 입력 불변.
 *
 * 규칙 (metrics.ts 레지스트리):
 * - sum: 합계. `missingAsZero` 면 포인트 없는 버킷도 0, 아니면 null.
 * - avg: 평균 (decimals 반올림). `withMinMax` 면 min/max.
 * - max: 버킷 최고값.
 * - last: 버킷 안 최신 ymd 의 값.
 * - `withLast`: 규칙과 별개로 last 를 병기.
 * - coveredDays: 값이 있는 **날** 수 (같은 날 포인트가 여러 개여도 1일).
 * - 모든 출력값(value · min · max · last)은 `decimals` 로 반올림 — 평균선이 min/max 밴드 밖으로 나가지 않게.
 */
import { bucketKeyOf, type HistoryBucket } from "./buckets";
import type { HistoryMetricDef } from "./metrics";

export interface DailyPoint {
  ymd: string;
  value: number;
}

export interface BucketValue {
  value: number | null;
  coveredDays: number;
  min?: number | null;
  max?: number | null;
  last?: number | null;
}

function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

function lastByYmd(points: readonly DailyPoint[], decimals: number): number | null {
  if (points.length === 0) return null;
  const latest = points.reduce((acc, p) => (p.ymd > acc.ymd ? p : acc));
  return roundTo(latest.value, decimals);
}

function aggregateValue(points: readonly DailyPoint[], def: HistoryMetricDef): number | null {
  if (points.length === 0) return def.missingAsZero ? 0 : null;
  const values = points.map((p) => p.value);
  switch (def.aggregate) {
    case "sum":
      return roundTo(values.reduce((s, v) => s + v, 0), def.decimals);
    case "avg":
      return roundTo(values.reduce((s, v) => s + v, 0) / values.length, def.decimals);
    case "max":
      return roundTo(Math.max(...values), def.decimals);
    case "last":
      return lastByYmd(points, def.decimals);
  }
}

/**
 * 포인트 묶음 하나 → 값. 버킷과 무관한 집계 본체 — `rollup` (버킷별) 과 `range-totals` (#395, 임의 구간 한 덩어리) 가 공유한다.
 */
export function aggregatePoints(points: readonly DailyPoint[], def: HistoryMetricDef): BucketValue {
  const result: BucketValue = {
    value: aggregateValue(points, def),
    coveredDays: new Set(points.map((p) => p.ymd)).size,
  };
  const withMinMax = def.withMinMax
    ? {
        min: points.length ? roundTo(Math.min(...points.map((p) => p.value)), def.decimals) : null,
        max: points.length ? roundTo(Math.max(...points.map((p) => p.value)), def.decimals) : null,
      }
    : {};
  const withLast = def.withLast ? { last: lastByYmd(points, def.decimals) } : {};
  return { ...result, ...withMinMax, ...withLast };
}

export function rollup(
  points: readonly DailyPoint[],
  buckets: readonly HistoryBucket[],
  def: HistoryMetricDef,
): BucketValue[] {
  if (buckets.length === 0) return [];
  const granularity = buckets[0].granularity;
  // 로컬 누적기 push — 입력·반환 배열은 그대로 (순수 함수 유지). spread 재생성은 O(n²) (사전 리뷰 info 3).
  const grouped = new Map<string, DailyPoint[]>();
  for (const p of points) {
    const key = bucketKeyOf(p.ymd, granularity);
    const list = grouped.get(key);
    if (list) list.push(p);
    else grouped.set(key, [p]);
  }

  return buckets.map((bucket) => aggregatePoints(grouped.get(bucket.key) ?? [], def));
}

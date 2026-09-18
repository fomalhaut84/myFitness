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

function lastByYmd(points: readonly DailyPoint[]): number | null {
  if (points.length === 0) return null;
  const latest = points.reduce((acc, p) => (p.ymd > acc.ymd ? p : acc));
  return latest.value;
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
      return Math.max(...values);
    case "last":
      return lastByYmd(points);
  }
}

export function rollup(
  points: readonly DailyPoint[],
  buckets: readonly HistoryBucket[],
  def: HistoryMetricDef,
): BucketValue[] {
  if (buckets.length === 0) return [];
  const granularity = buckets[0].granularity;
  const grouped = new Map<string, DailyPoint[]>();
  for (const p of points) {
    const key = bucketKeyOf(p.ymd, granularity);
    grouped.set(key, [...(grouped.get(key) ?? []), p]);
  }

  return buckets.map((bucket) => {
    const inBucket = grouped.get(bucket.key) ?? [];
    const result: BucketValue = {
      value: aggregateValue(inBucket, def),
      coveredDays: new Set(inBucket.map((p) => p.ymd)).size,
    };
    const withMinMax = def.withMinMax
      ? {
          min: inBucket.length ? Math.min(...inBucket.map((p) => p.value)) : null,
          max: inBucket.length ? Math.max(...inBucket.map((p) => p.value)) : null,
        }
      : {};
    const withLast = def.withLast ? { last: lastByYmd(inBucket) } : {};
    return { ...result, ...withMinMax, ...withLast };
  });
}

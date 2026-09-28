// #405 · #408: 히스토리 하한 경계 순수 헬퍼. prisma 를 import 하지 않는다 — route-params (클라이언트 번들) 가 쓴다.
import { diffDaysYmd } from "./buckets";

/** #405: 기록 없는 설치에서 미래 체중 기록으로 하한이 오늘보다 미래가 될 수 있다 — 입구에서 오늘로 정규화 */
export function effectiveLowerBound(lowerBound: string, today: string): string {
  return lowerBound > today ? today : lowerBound;
}

/**
 * #408-1: 커버리지 분모. 버킷은 달력 전체 (#393) 라 하한이 걸친 첫 버킷은 `totalDays` 에 조회 불가능한 날이 섞인다 —
 * 하한 이전 일수를 뺀다. 오늘 이후는 `enumerateBuckets` 가 이미 세지 않는다. `/history` 연 뷰 (#394 info 4) 와 `/trends` 공용.
 */
export function coverableDays(bucket: { start: string; totalDays: number }, lowerBound: string): number {
  const beforeLowerBound = bucket.start < lowerBound ? diffDaysYmd(bucket.start, lowerBound) : 0;
  return Math.max(0, bucket.totalDays - beforeLowerBound);
}

/** #408-2: 조회 범위 = 버킷 스팬 ∩ [하한, 오늘]. 첫 주 버킷은 하한 이전 월요일부터라 그대로 조회하면 하한 앞 행이 들어온다. 비면 null */
export function clipSpan(
  span: { fromYmd: string; toYmd: string } | null,
  ctx: { lowerBound: string; today: string },
): { fromYmd: string; toYmd: string } | null {
  if (span === null) return null;
  const fromYmd = span.fromYmd < ctx.lowerBound ? ctx.lowerBound : span.fromYmd;
  const toYmd = span.toYmd > ctx.today ? ctx.today : span.toYmd;
  return fromYmd > toYmd ? null : { fromYmd, toYmd };
}

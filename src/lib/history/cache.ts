/**
 * #394 (M15-2): 히스토리 캐시 싱글턴 (서버 전용). 코어·키 규칙은 `cache-core.ts`.
 *
 * 인스턴스는 `globalThis` 에 둔다 — 수동 쓰기 route (bump) 와 `/history` 페이지 (get) 가 서로 다른 번들에
 * 들어가도 같은 캐시·버전을 봐야 한다. 유효 범위는 Next 프로세스 하나 (`myfitness`). 봇 프로세스의 식단 기록은
 * 버전도 stamp 도 못 올리므로 연·월 뷰에 최대 TTL 만큼 늦게 반영된다 (394 스펙 §4.6 — 수용).
 */
import prisma from "@/lib/prisma";
import { createHistoryCache, summaryCacheKey, type HistoryCache } from "./cache-core";
import { getHistoryLowerBound } from "./lower-bound";
import type { HistoryMetricId } from "./metrics";
import { getHistoryRangeTotals, type HistoryRangeTotals } from "./range-totals";
import { getHistorySummary, type HistorySummary } from "./summary";
import type { SummaryParams } from "./summary-params";

const globalForCache = globalThis as unknown as { historyCache: HistoryCache | undefined };

/** 연 뷰 1회 렌더가 캐시를 4번 조회한다 — stamp 를 짧게 재사용해 웜 렌더의 DB 왕복을 1회로 (사전 리뷰 info 3). */
const SYNC_STAMP_REUSE_MS = 5_000;
let stampMemo: { value: Promise<string>; at: number } | null = null;

function getSyncStamp(): Promise<string> {
  const now = Date.now();
  if (stampMemo && now - stampMemo.at < SYNC_STAMP_REUSE_MS) return stampMemo.value;
  const value = prisma.syncMetadata
    .aggregate({ _max: { lastSyncAt: true } })
    .then((agg) => agg._max.lastSyncAt?.toISOString() ?? "never");
  const memo = { value, at: now };
  stampMemo = memo;
  value.catch(() => {
    if (stampMemo === memo) stampMemo = null;
  });
  return value;
}

function cache(): HistoryCache {
  if (!globalForCache.historyCache) {
    globalForCache.historyCache = createHistoryCache({ getSyncStamp, now: () => Date.now() });
  }
  return globalForCache.historyCache;
}

/** 수동 쓰기 route (체중 · 식단) 성공 경로에서 호출. */
export function bumpHistoryCacheVersion(): void {
  cache().bump();
}

export function getCachedLowerBound(): Promise<string> {
  return cache().get("lowerBound", getHistoryLowerBound);
}

export async function getCachedHistorySummary(
  params: SummaryParams,
  ctx: { lowerBound: string; today: string },
): Promise<HistorySummary> {
  const cached = await cache().get(summaryCacheKey(params, ctx), () => getHistorySummary(params, ctx));
  // 캐시 값은 공유 객체 — 변형하지 않고 호출자별 echo 필드만 얹은 새 객체를 돌려준다
  return { ...cached, clampedFrom: params.clampedFrom, clampedTo: params.clampedTo };
}

/**
 * #395: 임의 구간 한 덩어리 롤업 (`/trends` 기간 비교 · 기간 전체 판독값).
 * 결과는 (from, to, 지표, DB) 에만 의존하고 DB 변동은 stamp · version 이 덮는다. **호출자가 `to` 를 오늘 이하로 클램프** 해서
 * 넘긴다는 전제 — 미래가 낀 구간을 넘기면 자정 이후에도 같은 키로 옛 값이 나온다.
 */
export function getCachedRangeTotals(
  range: { from: string; to: string },
  metricIds: readonly HistoryMetricId[],
): Promise<HistoryRangeTotals> {
  const key = JSON.stringify(["rangeTotals", range.from, range.to, [...metricIds].sort()]);
  return cache().get(key, () => getHistoryRangeTotals(range, metricIds));
}

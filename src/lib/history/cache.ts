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
import { getHistorySummary, type HistorySummary } from "./summary";
import type { SummaryParams } from "./summary-params";

const globalForCache = globalThis as unknown as { historyCache: HistoryCache | undefined };

async function getSyncStamp(): Promise<string> {
  const agg = await prisma.syncMetadata.aggregate({ _max: { lastSyncAt: true } });
  return agg._max.lastSyncAt?.toISOString() ?? "never";
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

export function getCachedHistorySummary(
  params: SummaryParams,
  ctx: { lowerBound: string; today: string },
): Promise<HistorySummary> {
  return cache().get(summaryCacheKey(params, ctx.today), () => getHistorySummary(params, ctx));
}

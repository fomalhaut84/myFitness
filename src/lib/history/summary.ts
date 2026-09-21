/**
 * #393 (M15-1): 히스토리 요약 — 버킷 생성 + 조회 + 롤업 조합. 서버 컴포넌트는 이 함수를 직접 호출하고
 * (fetch 왕복 없음), `/api/history/summary` 는 클라이언트 지표 전환용으로 같은 함수를 감싼다.
 */
import { todayKSTString } from "@/lib/garmin/utils";
import { MIN_HISTORY_YMD } from "@/lib/date";
import { bucketSpan, enumerateBuckets, type HistoryGranularity } from "./buckets";
import { loadDailyPoints, type DailyPointsByMetric } from "./load";
import { getHistoryLowerBound } from "./lower-bound";
import { getHistoryMetric, type HistoryAggregate, type HistoryMetricId } from "./metrics";
import { rollup, type BucketValue } from "./rollup";
import { parseSummaryParams, type ParseResult, type SummaryParams, type SummaryRawParams } from "./summary-params";

export interface SummaryMetricMeta {
  label: string;
  unit: string;
  decimals: number;
  aggregate: HistoryAggregate;
  missingAsZero: boolean;
}

export interface SummaryBucket {
  key: string;
  /** KST 달력일 (inclusive) */
  start: string;
  /** KST 달력일 (exclusive) */
  end: string;
  totalDays: number;
  values: Partial<Record<HistoryMetricId, BucketValue>>;
}

export interface HistorySummary {
  granularity: HistoryGranularity;
  from: string;
  to: string;
  clampedFrom: boolean;
  clampedTo: boolean;
  lowerBound: string;
  today: string;
  metrics: Partial<Record<HistoryMetricId, SummaryMetricMeta>>;
  buckets: SummaryBucket[];
}

/**
 * 검증 컨텍스트(오늘 · 하한)를 DB 에서 채워 파라미터를 검증한다.
 * 형식·순서 오류는 하한 조회 없이 먼저 걸러낸다 (사전 리뷰 info 5 — 400 에 DB 5회 왕복 방지).
 */
export async function validateSummaryParams(
  raw: SummaryRawParams,
  // #394: route 는 캐시된 하한(`getCachedLowerBound`)을 주입한다. cache.ts 가 이 모듈을 import 하므로 기본값은 비캐시.
  lowerBoundLoader: () => Promise<string> = getHistoryLowerBound,
): Promise<ParseResult & { lowerBound: string; today: string }> {
  const today = todayKSTString();
  const pure = parseSummaryParams(raw, { todayYmd: today, lowerBound: MIN_HISTORY_YMD });
  if (!pure.ok) return { ...pure, lowerBound: MIN_HISTORY_YMD, today };
  const lowerBound = await lowerBoundLoader();
  return { ...parseSummaryParams(raw, { todayYmd: today, lowerBound }), lowerBound, today };
}

export type DailyPointsLoader = (fromYmd: string, toYmd: string, metricIds: readonly HistoryMetricId[]) => Promise<DailyPointsByMetric>;

export async function getHistorySummary(
  params: SummaryParams,
  ctx: { lowerBound: string; today: string },
  loader: DailyPointsLoader = loadDailyPoints,
): Promise<HistorySummary> {
  const buckets = enumerateBuckets(params.from, params.to, params.granularity, ctx.today);
  // 첫/끝 버킷은 달력 전체(§4.1)이므로 조회도 버킷 스팬으로 — from/to 로 조회하면 부분 합계가 된다
  // (#393 사전 리뷰 major 1). 하한 이전·오늘 이후는 행이 없어 무해.
  const span = bucketSpan(buckets);
  const points = span ? await loader(span.fromYmd, span.toYmd, params.metrics) : {};

  const rolled = params.metrics.map((id) => [id, rollup(points[id] ?? [], buckets, getHistoryMetric(id))] as const);

  const metrics = Object.fromEntries(
    params.metrics.map((id) => {
      const def = getHistoryMetric(id);
      const meta: SummaryMetricMeta = {
        label: def.label,
        unit: def.unit,
        decimals: def.decimals,
        aggregate: def.aggregate,
        missingAsZero: def.missingAsZero,
      };
      return [id, meta];
    }),
  );

  return {
    granularity: params.granularity,
    from: params.from,
    to: params.to,
    clampedFrom: params.clampedFrom,
    clampedTo: params.clampedTo,
    lowerBound: ctx.lowerBound,
    today: ctx.today,
    metrics,
    buckets: buckets.map((b, i) => ({
      key: b.key,
      start: b.startYmd,
      end: b.endYmd,
      totalDays: b.totalDays,
      values: Object.fromEntries(rolled.map(([id, values]) => [id, values[i]])),
    })),
  };
}

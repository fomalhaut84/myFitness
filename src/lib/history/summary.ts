/**
 * #393 (M15-1): 히스토리 요약 — 버킷 생성 + 조회 + 롤업 조합. 서버 컴포넌트는 이 함수를 직접 호출하고
 * (fetch 왕복 없음), `/api/history/summary` 는 클라이언트 지표 전환용으로 같은 함수를 감싼다.
 */
import { todayKSTString } from "@/lib/garmin/utils";
import { enumerateBuckets, type HistoryGranularity } from "./buckets";
import { loadDailyPoints } from "./load";
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

/** 검증 컨텍스트(오늘 · 하한)를 DB 에서 채워 파라미터를 검증한다. */
export async function validateSummaryParams(raw: SummaryRawParams): Promise<ParseResult & { lowerBound: string; today: string }> {
  const lowerBound = await getHistoryLowerBound();
  const today = todayKSTString();
  return { ...parseSummaryParams(raw, { todayYmd: today, lowerBound }), lowerBound, today };
}

export async function getHistorySummary(
  params: SummaryParams,
  ctx: { lowerBound: string; today: string },
): Promise<HistorySummary> {
  const buckets = enumerateBuckets(params.from, params.to, params.granularity, ctx.today);
  const points = await loadDailyPoints(params.from, params.to, params.metrics);

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

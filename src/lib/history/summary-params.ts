/**
 * #393 (M15-1): `/api/history/summary` 파라미터 검증. 순수 (DB · 시계 없음 — ctx 로 주입).
 *
 * - 형식·실존·순서 오류 → `{ ok: false, error }` (route 가 400).
 * - `from < lowerBound` → 클램프 + `clampedFrom` (400 으로 막으면 연 뷰 첫 해 링크가 깨진다).
 * - `to > today` → today 로 클램프 + `clampedTo`.
 * - `granularity=day` 는 MAX_DAY_GRANULARITY_SPAN 일까지 (버킷 폭주 방지).
 */
import { diffDaysYmd, isHistoryGranularity, isValidYmd, type HistoryGranularity } from "./buckets";
import { HISTORY_METRIC_IDS, isHistoryMetricId, type HistoryMetricId } from "./metrics";

export const MAX_DAY_GRANULARITY_SPAN = 366;

export interface SummaryParams {
  granularity: HistoryGranularity;
  from: string;
  to: string;
  metrics: HistoryMetricId[];
  clampedFrom: boolean;
  clampedTo: boolean;
}

export interface SummaryRawParams {
  granularity?: string | null;
  from?: string | null;
  to?: string | null;
  metrics?: string | null;
}

export interface SummaryContext {
  todayYmd: string;
  lowerBound: string;
}

export type ParseResult = { ok: true; params: SummaryParams } | { ok: false; error: string };

function parseMetrics(raw: string | null | undefined): { ok: true; ids: HistoryMetricId[] } | { ok: false; error: string } {
  if (!raw || raw.trim() === "") return { ok: true, ids: [...HISTORY_METRIC_IDS] };
  const tokens = raw.split(",").map((t) => t.trim()).filter((t) => t !== "");
  const unknown = tokens.filter((t) => !isHistoryMetricId(t));
  if (unknown.length > 0) {
    return { ok: false, error: `미등록 metrics: ${unknown.join(", ")} (허용: ${HISTORY_METRIC_IDS.join(", ")})` };
  }
  const ids = tokens.filter(isHistoryMetricId);
  return { ok: true, ids: [...new Set(ids)] };
}

export function parseSummaryParams(raw: SummaryRawParams, ctx: SummaryContext): ParseResult {
  if (!isHistoryGranularity(raw.granularity)) {
    return { ok: false, error: "granularity 는 day | week | month | year 중 하나여야 합니다" };
  }
  if (!raw.from || !isValidYmd(raw.from)) {
    return { ok: false, error: "from 은 YYYY-MM-DD 형식의 실존 날짜여야 합니다" };
  }
  if (!raw.to || !isValidYmd(raw.to)) {
    return { ok: false, error: "to 는 YYYY-MM-DD 형식의 실존 날짜여야 합니다" };
  }
  if (raw.from > raw.to) {
    return { ok: false, error: `from(${raw.from}) 이 to(${raw.to}) 보다 뒤입니다` };
  }

  const clampedFrom = raw.from < ctx.lowerBound;
  const clampedTo = raw.to > ctx.todayYmd;
  const from = clampedFrom ? ctx.lowerBound : raw.from;
  const to = clampedTo ? ctx.todayYmd : raw.to;
  if (from > to) {
    return { ok: false, error: `조회 가능 범위(${ctx.lowerBound} ~ ${ctx.todayYmd}) 밖입니다` };
  }
  if (raw.granularity === "day" && diffDaysYmd(from, to) + 1 > MAX_DAY_GRANULARITY_SPAN) {
    return { ok: false, error: `granularity=day 는 최대 ${MAX_DAY_GRANULARITY_SPAN}일까지 조회할 수 있습니다` };
  }

  const metrics = parseMetrics(raw.metrics);
  if (!metrics.ok) return metrics;

  return {
    ok: true,
    params: { granularity: raw.granularity, from, to, metrics: metrics.ids, clampedFrom, clampedTo },
  };
}

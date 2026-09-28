// #397 D: 주간 km → 다음 주 안정시 심박 — "많이 뛴 다음 주에 심박이 오르나?". 지연 0 · 1 · 2 의 r 과 km 구간 표가 답.
import { LOW_COVERAGE_RATIO, partialReason } from "@/lib/history/trends";
import type { SummaryBucket } from "@/lib/history/summary";
import { mean, pearson } from "./stats";
import type { InsightContext } from "./types";

export interface LagPair {
  /** 기준 주 (km 쪽) 의 시작 ymd · 연도 */
  weekKey: string;
  year: number;
  km: number;
  /** `lag` 주 뒤의 평균 안정시 심박 */
  rhr: number;
}

/**
 * 주 버킷 (`runningKm` 합 · `restingHR` 평균) → 쌍 (km[w], rhr[w+lag]).
 * 제외: 미완결 주 (양쪽) · RHR 결측 · RHR 기록이 절반 미만인 주. km 은 `missingAsZero` 라 0 이 진짜 0.
 */
export function lagPairs(weeks: readonly SummaryBucket[], lag: number, ctx: InsightContext): LagPair[] {
  const out: LagPair[] = [];
  for (let i = 0; i + lag < weeks.length; i++) {
    const a = weeks[i];
    const b = weeks[i + lag];
    if (partialReason(a, ctx) !== null || partialReason(b, ctx) !== null) continue;
    const km = a.values.runningKm?.value;
    const rhr = b.values.restingHR;
    if (km === null || km === undefined || !rhr || rhr.value === null) continue;
    if (b.totalDays <= 0 || rhr.coveredDays / b.totalDays < LOW_COVERAGE_RATIO) continue;
    out.push({ weekKey: a.key, year: Number(a.start.slice(0, 4)), km, rhr: rhr.value });
  }
  return out;
}

export interface LagCorrelation {
  lag: number;
  r: number | null;
  n: number;
}

export function lagCorrelations(weeks: readonly SummaryBucket[], lags: readonly number[], ctx: InsightContext): LagCorrelation[] {
  return lags.map((lag) => {
    const pairs = lagPairs(weeks, lag, ctx);
    return { lag, r: pearson(pairs.map((p) => ({ x: p.km, y: p.rhr }))), n: pairs.length };
  });
}

/** 주간 km 구간 — 0~20 · 20~35 · 35~50 · 50+ (상한 exclusive) */
export const KM_BAND_EDGES: readonly number[] = [20, 35, 50];

export interface KmBand {
  from: number;
  to: number | null;
  label: string;
  n: number;
  avgRhr: number | null;
}

export function kmBandTable(pairs: readonly LagPair[], edges: readonly number[] = KM_BAND_EDGES): KmBand[] {
  const bounds = [0, ...edges];
  return bounds.map((from, i) => {
    const to = i < edges.length ? edges[i] : null;
    const inBand = pairs.filter((p) => p.km >= from && (to === null || p.km < to)).map((p) => p.rhr);
    const avg = mean(inBand);
    return { from, to, label: to === null ? `${from}+` : `${from}~${to}`, n: inBand.length, avgRhr: avg === null ? null : Math.round(avg * 10) / 10 };
  });
}

// #397 C: 월별 심박 존 비율 — "강도 배분이 달라졌나?". 존 1~2 (이지) · 존 4~5 (고강도) 12개월 비교가 답.
import type { ZoneDistribution } from "@/lib/fitness/intensity";
import { addMonthsYm } from "@/lib/history/month-cells";
import { LOW_COVERAGE_RATIO } from "@/lib/history/trends";
import type { InsightContext, InsightRun } from "./types";

export const ZONE_KEYS = ["z1", "z2", "z3", "z4", "z5"] as const;
export type ZoneShare = [number, number, number, number, number];

export interface ZoneMonth {
  /** YYYY-MM */
  key: string;
  runs: number;
  withZones: number;
  /** 존 있는 러닝이 그 달 러닝의 절반 미만 (러닝이 있을 때만) */
  lowCoverage: boolean;
  /** 오늘이 속한 달 */
  current: boolean;
  /** 존 있는 러닝이 없으면 null */
  share: ZoneShare | null;
  /** 존별 초 합 */
  seconds: ZoneShare | null;
}

function sumZones(runs: readonly InsightRun[]): ZoneShare | null {
  const withZones = runs.filter((r): r is InsightRun & { zones: ZoneDistribution } => r.zones !== null);
  if (withZones.length === 0) return null;
  return ZONE_KEYS.map((k) => withZones.reduce((s, r) => s + Math.max(0, r.zones[k] || 0), 0)) as ZoneShare;
}

/** 존 있는 첫 달 ~ 오늘이 속한 달 (빈 달 포함). 존 있는 러닝이 하나도 없으면 빈 배열. 월 키는 ymd 슬라이스 (KST). */
export function zoneShareByMonth(runs: readonly InsightRun[], ctx: InsightContext): ZoneMonth[] {
  const firstYmd = runs.filter((r) => r.zones !== null).map((r) => r.ymd).sort()[0];
  if (!firstYmd) return [];
  const byMonth = new Map<string, InsightRun[]>();
  for (const r of runs) {
    const key = r.ymd.slice(0, 7);
    byMonth.set(key, [...(byMonth.get(key) ?? []), r]);
  }
  const todayYm = ctx.today.slice(0, 7);
  const months: ZoneMonth[] = [];
  for (let ym = firstYmd.slice(0, 7); ym <= todayYm; ym = addMonthsYm(ym, 1)) {
    const inMonth = byMonth.get(ym) ?? [];
    const seconds = sumZones(inMonth);
    const total = seconds ? seconds.reduce((s, v) => s + v, 0) : 0;
    const withZones = inMonth.filter((r) => r.zones !== null).length;
    months.push({
      key: ym,
      runs: inMonth.length,
      withZones,
      lowCoverage: inMonth.length > 0 && withZones / inMonth.length < LOW_COVERAGE_RATIO,
      current: ym === todayYm,
      share: seconds && total > 0 ? (seconds.map((v) => v / total) as ZoneShare) : null,
      seconds,
    });
  }
  return months;
}

export interface ZonePeriodShare {
  months: number;
  /** 존 1~2 시간 비율 (달 평균) */
  easy: number | null;
  /** 존 4~5 */
  hard: number | null;
}

function periodShare(months: readonly ZoneMonth[]): ZonePeriodShare {
  const usable = months.filter((m) => m.share !== null && !m.lowCoverage);
  if (usable.length === 0) return { months: 0, easy: null, hard: null };
  const avg = (pick: (s: ZoneShare) => number) => usable.reduce((s, m) => s + pick(m.share as ZoneShare), 0) / usable.length;
  return { months: usable.length, easy: avg((s) => s[0] + s[1]), hard: avg((s) => s[3] + s[4]) };
}

/**
 * 최근 12개월 (오늘이 속한 달 포함 — 진행 중이어도 비율은 의미가 있다) vs 그 전 12개월.
 * 저커버리지 · 존 없는 달은 양쪽 모두에서 뺀다.
 */
export function zoneShareCompare(months: readonly ZoneMonth[], ctx: InsightContext): { recent: ZonePeriodShare; previous: ZonePeriodShare } {
  const todayYm = ctx.today.slice(0, 7);
  const recentFrom = addMonthsYm(todayYm, -11);
  const previousFrom = addMonthsYm(todayYm, -23);
  return {
    recent: periodShare(months.filter((m) => m.key >= recentFrom && m.key <= todayYm)),
    previous: periodShare(months.filter((m) => m.key >= previousFrom && m.key < recentFrom)),
  };
}

// #397 A: 페이스 대비 심박 효율 — "같은 페이스, 더 낮은 심박?". 기준 페이스 구간의 연도별 평균 심박이 답.
import { mean } from "./stats";
import type { InsightRun } from "./types";

/** 기준 페이스 구간 (초/km, [from, to)) — 5'00" ~ 5'30". 사용자 평균 페이스 근처의 30초 폭. 상수 1곳 (스펙 F5). */
export const EFFICIENCY_BAND: readonly [number, number] = [300, 330];
/** 구간에 이보다 적은 해는 평균을 내지 않는다 */
export const MIN_BAND_RUNS = 5;

export interface EfficiencyPoint {
  id: string;
  ymd: string;
  year: number;
  pace: number;
  hr: number;
  distanceM: number;
  race: boolean;
}

export function efficiencyPoints(runs: readonly InsightRun[]): EfficiencyPoint[] {
  return runs.flatMap((r) =>
    r.avgHR === null || r.avgHR <= 0 ? [] : [{ id: r.id, ymd: r.ymd, year: r.year, pace: r.avgPace, hr: r.avgHR, distanceM: r.distanceM, race: r.race }],
  );
}

export interface EfficiencyYear {
  year: number;
  n: number;
  /** 5건 미만이면 null */
  avgHr: number | null;
}

/**
 * 연도 오름차순 · 구간 [from, to). `years` 를 주면 그 해 전부를 열로 (구간에 러닝이 없는 해는 n=0 · null) — 표의 열이 비지 않게.
 * 주지 않으면 구간에 포인트가 있는 해만.
 */
export function efficiencyByYear(
  points: readonly EfficiencyPoint[],
  band: readonly [number, number] = EFFICIENCY_BAND,
  years?: readonly number[],
): EfficiencyYear[] {
  const byYear = new Map<number, number[]>();
  for (const p of points) {
    if (p.pace < band[0] || p.pace >= band[1]) continue;
    byYear.set(p.year, [...(byYear.get(p.year) ?? []), p.hr]);
  }
  const keys = years ? [...years] : [...byYear.keys()];
  return keys
    .sort((a, b) => a - b)
    .map((year) => {
      const hrs = byYear.get(year) ?? [];
      return { year, n: hrs.length, avgHr: hrs.length >= MIN_BAND_RUNS ? Math.round(mean(hrs) as number) : null };
    });
}

/** 답 한 줄: 첫 해 (평균이 있는) 와 마지막 해의 차이. 둘 중 하나라도 없으면 null. */
export function efficiencyDelta(years: readonly EfficiencyYear[]): { firstYear: number; lastYear: number; from: number; to: number; delta: number } | null {
  const usable = years.filter((y) => y.avgHr !== null);
  if (usable.length < 2) return null;
  const first = usable[0];
  const last = usable[usable.length - 1];
  return { firstYear: first.year, lastYear: last.year, from: first.avgHr as number, to: last.avgHr as number, delta: (last.avgHr as number) - (first.avgHr as number) };
}

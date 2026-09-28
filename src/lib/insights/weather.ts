// #397 B: 기온 vs 페이스 — "여름이 페이스를 얼마나 깎나?". 5°C 구간별 중앙값 페이스가 답.
import { median } from "./stats";
import type { UsableRun } from "./types";

/** 습도 3단: 0 = 50% 미만 · 1 = 50~75% · 2 = 75% 초과. null 은 중간 단 */
export type HumidityLevel = 0 | 1 | 2;
export const HUMIDITY_LABELS: Record<HumidityLevel, string> = { 0: "습도 50% 미만", 1: "습도 50~75%", 2: "습도 75% 초과" };

export function humidityLevel(pct: number | null): HumidityLevel {
  if (pct === null) return 1;
  if (pct < 50) return 0;
  if (pct <= 75) return 1;
  return 2;
}

export interface WeatherPoint {
  id: string;
  ymd: string;
  year: number;
  tempC: number;
  humidityPct: number | null;
  humidity: HumidityLevel;
  pace: number;
  distanceM: number;
}

export function weatherPoints(runs: readonly UsableRun[]): WeatherPoint[] {
  return runs.flatMap((r) =>
    r.tempC === null ? [] : [{ id: r.id, ymd: r.ymd, year: r.year, tempC: r.tempC, humidityPct: r.humidityPct, humidity: humidityLevel(r.humidityPct), pace: r.avgPace, distanceM: r.distanceM }],
  );
}

export const TEMP_BIN_C = 5;
/** 구간 축 — `< 5` 부터 `≥ 30` 까지 7칸 (제주 러닝 기온 범위) */
export const TEMP_BIN_EDGES: readonly number[] = [5, 10, 15, 20, 25, 30];
export const MIN_BIN_RUNS = 5;

export interface TempBin {
  /** 하한 (null = 열린 왼쪽) · 상한 (null = 열린 오른쪽), [from, to) */
  from: number | null;
  to: number | null;
  label: string;
  n: number;
  medianPace: number | null;
}

export function tempBinIndex(tempC: number, edges: readonly number[] = TEMP_BIN_EDGES): number {
  let i = 0;
  while (i < edges.length && tempC >= edges[i]) i++;
  return i;
}

export function paceByTempBin(points: readonly WeatherPoint[], edges: readonly number[] = TEMP_BIN_EDGES): TempBin[] {
  const buckets: number[][] = Array.from({ length: edges.length + 1 }, () => []);
  for (const p of points) buckets[tempBinIndex(p.tempC, edges)].push(p.pace);
  return buckets.map((paces, i) => {
    const from = i === 0 ? null : edges[i - 1];
    const to = i === edges.length ? null : edges[i];
    const label = from === null ? `< ${to}` : to === null ? `≥ ${from}` : `${from}~${to}`;
    return { from, to, label, n: paces.length, medianPace: paces.length >= MIN_BIN_RUNS ? median(paces) : null };
  });
}

/** 답 한 줄: `≥ 30` 구간 vs `10~15` 구간 (초/km). 둘 중 하나라도 없으면 null. */
export function heatPenalty(bins: readonly TempBin[]): { hot: TempBin; mild: TempBin; deltaSec: number } | null {
  const hot = bins.find((b) => b.from === 30);
  const mild = bins.find((b) => b.from === 10);
  if (!hot || !mild || hot.medianPace === null || mild.medianPace === null) return null;
  return { hot, mild, deltaSec: Math.round(hot.medianPace - mild.medianPace) };
}

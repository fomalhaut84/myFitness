// #397 F3: 산점도 공통 필터 — 짧은 워밍업 · 트랙 반복 (3km 미만) 과 GPS 튐 (페이스 범위 밖) 을 뺀다.
import type { InsightRun } from "./types";

export const MIN_DISTANCE_M = 3000;
/** 초/km — 2'30" ~ 15'00" */
export const PACE_RANGE: readonly [number, number] = [150, 900];

export interface UsableRuns {
  kept: InsightRun[];
  dropped: number;
  total: number;
}

export function usableRuns(runs: readonly InsightRun[]): UsableRuns {
  const kept = runs.filter((r) => r.distanceM >= MIN_DISTANCE_M && r.avgPace >= PACE_RANGE[0] && r.avgPace <= PACE_RANGE[1]);
  return { kept, dropped: runs.length - kept.length, total: runs.length };
}

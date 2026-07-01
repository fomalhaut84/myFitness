// M6-1: workout 타입별 target pace 및 zone 계산.
// LTHR pace 를 기준으로 상대 배율 적용. LTHR pace 부재 시 최근 평균 pace × 1.10 을 pseudo-LTHR 로 사용.

import type { WorkoutType } from "./workout-patterns";

export interface PaceZone {
  paceSecPerKm: number;
  zone: string;
}

// LTHR pace 대비 배율. 러너의 임계 페이스 기준.
// easy/long = Z2 (LTHR 페이스 +18~22%), tempo = Z3-4 (+5%), interval = Z5 (-5%), recovery = Z1 (+30%).
const MULTIPLIERS: Record<WorkoutType, { mult: number; zone: string } | null> = {
  easy: { mult: 1.20, zone: "Z2" },
  long: { mult: 1.22, zone: "Z2" },
  tempo: { mult: 1.05, zone: "Z3-4" },
  interval: { mult: 0.95, zone: "Z5" },
  recovery: { mult: 1.30, zone: "Z1" },
  rest: null,
};

export function paceZoneFor(
  type: WorkoutType,
  lthrPaceSecPerKm: number
): PaceZone | null {
  const conf = MULTIPLIERS[type];
  if (!conf) return null;
  return {
    paceSecPerKm: Math.round(lthrPaceSecPerKm * conf.mult),
    zone: conf.zone,
  };
}

/**
 * LTHR pace 부재 시 pseudo-LTHR 계산.
 * 최근 평균 pace 는 대체로 easy 페이스 근처이므로, LTHR pace ≈ easy pace / 1.20 로 역산.
 */
export function pseudoLthrPace(recentAvgPaceSecPerKm: number): number {
  return recentAvgPaceSecPerKm / 1.20;
}

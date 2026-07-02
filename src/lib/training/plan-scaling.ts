// M8: 목표 거리별 baseline 스케일링 + long run 피크 최소 보장.
// baseline (히스토리) 을 targetDistance 에 맞춰 조정하되, 사용자 실측 최대 주간 km 대비
// 무리한 상향을 방지 (sanity cap).

import { MIN_BASELINE_WEEKLY_KM } from "./baseline";

export type TargetDistance = "5K" | "10K" | "HM" | "FM";

// 목표별 volume 배율. 히스토리 baseline (10K 수준 가정) 대비 상대적.
export const TARGET_VOLUME_MULT: Record<TargetDistance, number> = {
  "5K": 0.9,
  "10K": 1.0,
  HM: 1.35,
  FM: 1.9,
};

// 목표별 Wk3 (peak) long run 최소 km. 위 배율로도 부족하면 이 값으로 강제 승격.
export const PEAK_LONG_MIN_KM: Record<TargetDistance, number> = {
  "5K": 7,
  "10K": 12,
  HM: 18,
  FM: 27,
};

// 사용자 최근 최대 주간 km 대비 상한 배율 (급격한 상향 방지).
export const HISTORICAL_CAP_MULT = 1.15;

export interface ScaledBaseline {
  finalBase: number;
  scaledForTarget: boolean;
  // 디버그/응답용 세부. UI 노출은 선택.
  rawBaseline: number;
  targetMult: number;
  historicalCap: number;
}

/**
 * target-aware baseline 계산.
 * finalBase = clamp(baseline × targetMult, MIN, historicalMax × CAP_MULT).
 * targetDistance null 이면 원 baseline 그대로 (scaledForTarget=false).
 */
export function scaleBaseline(
  baselineWeeklyKm: number,
  targetDistance: TargetDistance | null,
  historicalMaxWeekKm: number
): ScaledBaseline {
  if (targetDistance === null) {
    return {
      finalBase: baselineWeeklyKm,
      scaledForTarget: false,
      rawBaseline: baselineWeeklyKm,
      targetMult: 1.0,
      historicalCap: historicalMaxWeekKm * HISTORICAL_CAP_MULT,
    };
  }
  const targetMult = TARGET_VOLUME_MULT[targetDistance];
  const scaled = baselineWeeklyKm * targetMult;
  // historicalMax 가 0 (히스토리 없음) 이면 sanity cap 미적용.
  const historicalCap =
    historicalMaxWeekKm > 0
      ? historicalMaxWeekKm * HISTORICAL_CAP_MULT
      : Infinity;
  const capped = Math.min(scaled, historicalCap);
  const finalBase = Math.max(capped, MIN_BASELINE_WEEKLY_KM);
  return {
    finalBase: Math.round(finalBase * 10) / 10,
    scaledForTarget: true,
    rawBaseline: baselineWeeklyKm,
    targetMult,
    historicalCap,
  };
}

/**
 * plan-generator 가 workout distance 를 산출한 뒤, target 이 있으면 Wk3 long run
 * 이 PEAK_LONG_MIN_KM[target] 이상이 되도록 개별 승격. 다른 slot 은 유지.
 */
export function ensurePeakLongMin(
  weekBaseKm: number,
  currentLongKm: number,
  targetDistance: TargetDistance | null
): number {
  if (targetDistance === null) return currentLongKm;
  const min = PEAK_LONG_MIN_KM[targetDistance];
  return Math.max(currentLongKm, min);
}

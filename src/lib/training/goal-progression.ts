// M11 Phase 2 (#232): goalType 별 workout distance / pace 재계산 helper.
//
// distance 목표는 기존 로직 사용 (이 파일은 관여 X).
// time 목표: 주차별 tempo/interval pace 를 baseline → target 으로 선형 개선.
// endurance 목표: peak long run 을 사용자 지정 targetLongRunKm 으로 설정, 주차별 선형 ramp.

import type { WorkoutType } from "./workout-patterns";

// ─── Goal 타입 ─────────────────────────────────────────────────────────────

export type GoalType = "distance" | "time" | "endurance";

export interface DistanceGoalValue {
  // distance 는 별도 goalValue 페이로드 없음 (targetDistance / targetDate 컬럼 재사용).
  // Prisma Json 컬럼과의 호환을 위해 최소한의 sentinel 은 두지 않고 null 로 저장.
}

export interface TimeGoalValue {
  distance: string; // "5K" | "10K" | "HM" | "FM"
  targetTimeSec: number; // 예: 3000 (10K sub-50)
  targetDate: string; // "YYYY-MM-DD"
}

export interface EnduranceGoalValue {
  targetLongRunKm: number; // 사용자가 도달하려는 long run 최대 거리
  targetDate?: string; // optional (있으면 race taper window 적용)
}

// ─── 유효성 검사 (MCP tool / API 에서 재사용) ──────────────────────────────

export const TIME_GOAL_DISTANCE_M: Record<string, number> = {
  "5K": 5000,
  "10K": 10000,
  HM: 21097.5,
  FM: 42195,
};

const TARGET_LONG_RUN_MIN_KM = 1;
const TARGET_LONG_RUN_MAX_KM = 50;

/**
 * time goalValue 검증. 반환값이 있으면 오류 메시지 (사용자에게 노출),
 * null 이면 통과.
 */
export function validateTimeGoal(v: TimeGoalValue): string | null {
  const distanceMeters = TIME_GOAL_DISTANCE_M[v.distance];
  if (distanceMeters === undefined) {
    return `time 목표 distance 는 5K/10K/HM/FM 중 하나여야 합니다. 현재: ${v.distance}`;
  }
  if (!Number.isFinite(v.targetTimeSec) || v.targetTimeSec <= 0) {
    return `time 목표 targetTimeSec 는 양수 정수여야 합니다. 현재: ${v.targetTimeSec}`;
  }
  // sanity: 세계 최고 기록보다 빠른 목표는 typo 가능성 (5K 12분 미만 등)
  const minPossibleSecPerKm = 150; // 2:30/km (엘리트 세계 기록급 안전 하한)
  const impliedPace = v.targetTimeSec / (distanceMeters / 1000);
  if (impliedPace < minPossibleSecPerKm) {
    return `time 목표가 비현실적으로 빠릅니다 (평균 ${Math.round(impliedPace)}sec/km). targetTimeSec 값 확인 필요.`;
  }
  return null;
}

export function validateEnduranceGoal(v: EnduranceGoalValue): string | null {
  if (
    !Number.isFinite(v.targetLongRunKm) ||
    v.targetLongRunKm < TARGET_LONG_RUN_MIN_KM ||
    v.targetLongRunKm > TARGET_LONG_RUN_MAX_KM
  ) {
    return `endurance 목표 targetLongRunKm 는 ${TARGET_LONG_RUN_MIN_KM}~${TARGET_LONG_RUN_MAX_KM} 범위여야 합니다. 현재: ${v.targetLongRunKm}`;
  }
  return null;
}

// ─── time 목표: 주차별 target pace ─────────────────────────────────────────

/**
 * time 목표에서 workout type 별 페이스 재계산.
 * - tempo/interval: baseline pace → target pace 로 growth 주차 동안 선형 개선. peak 주에 target 도달.
 * - easy/long/recovery: baseline zone 페이스 유지 (회복/지구력, 강도 안 올림).
 *
 * @param baselinePace 최근 avgPace (sec/km). null 이면 개선 로직 skip → 기본 zone 페이스.
 * @param targetPace goalValue 로부터 계산된 목표 avg pace (sec/km).
 * @param week 0-based week index.
 * @param growthWeeks weekly-progression 의 growth 주 수 (peakWeekIdx + 1).
 */
export function targetPaceForWeek(
  slotType: WorkoutType,
  baselinePace: number | null,
  targetPace: number,
  week: number,
  growthWeeks: number,
): number | null {
  if (slotType !== "tempo" && slotType !== "interval") return null; // 다른 타입은 기존 zone 그대로 (호출자 fallback).
  if (baselinePace === null || baselinePace <= targetPace) {
    // baseline 페이스 정보 없음 or 이미 목표 도달 → 그대로 targetPace 사용.
    return Math.round(targetPace);
  }
  const paceGap = baselinePace - targetPace; // sec/km, 양수
  const clampedWeek = Math.min(week + 1, growthWeeks); // peak 주 이후는 growth 로 고정.
  const improvementFactor = clampedWeek / growthWeeks; // 0..1
  const weeklyPace = baselinePace - paceGap * improvementFactor;
  return Math.round(weeklyPace);
}

// ─── endurance 목표: 주차별 long run 거리 ────────────────────────────────

/**
 * endurance 목표에서 long slot 의 주차별 거리 재계산.
 * - growth 주: baselineLongKm → targetLongRunKm 선형 증대. peak 주에 target 도달.
 * - taper 주: targetLongRunKm × taperMultipliers[i] (완만 감소).
 *
 * @param baselineLongKm Wk1 (growth 시작) 의 계산된 long slot 거리 (baseline × weekMult × normalizedRatio).
 *                      호출자가 slot.volumeRatio × ratioNorm × baselineWeeklyKm × 1.0 로 산출.
 * @param targetLongRunKm 사용자 지정 peak 값.
 * @param week 0-based week index.
 * @param growthWeeks weekly-progression 의 growth 주 수.
 * @param taperFactor taper 주에 곱할 배율 (taper 아니면 undefined).
 */
export function longRunKmForWeek(
  baselineLongKm: number,
  targetLongRunKm: number,
  week: number,
  growthWeeks: number,
  taperFactor: number | undefined,
): number {
  if (taperFactor !== undefined) {
    // taper 주는 target 을 기준으로 완만 감소 (multipliers 자체를 재해석).
    // taperFactor 는 weekly-progression 의 taper 배율 (0.7~0.85). target 대비.
    return targetLongRunKm * taperFactor;
  }
  if (growthWeeks <= 1) return targetLongRunKm; // edge: growth 1주는 즉시 target.
  const step = (targetLongRunKm - baselineLongKm) / (growthWeeks - 1);
  const km = baselineLongKm + step * week;
  // target < baseline (감소 방향) 인 케이스도 지원 — 양방향 clamp.
  // 편측 clamp 를 하면 감소 방향에서 성장 주 전체가 baseline 에 고정되어 target 이 무시됨.
  const lo = Math.min(baselineLongKm, targetLongRunKm);
  const hi = Math.max(baselineLongKm, targetLongRunKm);
  return Math.max(lo, Math.min(hi, km));
}

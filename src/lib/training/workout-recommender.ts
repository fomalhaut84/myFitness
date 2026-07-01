// M6-4: 오늘 workout 조정 로직. 입력 (base workout + readiness label + injury label)
// → 조정된 workout + rationale. DB / IO 없음. 순수 함수.

import type { WorkoutType } from "./workout-patterns";
import { formatPace } from "../../mcp/tools/running-buckets";

export type ReadinessLabel =
  | "optimal"
  | "good"
  | "moderate"
  | "fatigued"
  | "depleted";

export type InjuryLabel = "safe" | "caution" | "elevated" | "high";

export interface BaseWorkout {
  source: "plan" | "fallback";
  type: WorkoutType;
  distanceKm: number | null;
  paceSecPerKm: number | null;
  zone: string | null;
  intervalDesc: string | null;
  planId?: string;
}

export interface RecommendedWorkout {
  type: WorkoutType;
  distanceKm: number | null;
  paceRange: { min: string; max: string } | null;
  zone: string | null;
  intervalDesc: string | null;
  adjusted: boolean;
  adjustmentReason: string | null;
}

/**
 * 조정 단계. 정수 = downgrade step (0 = keep, 1 = 한 단계, 2 = 두 단계).
 * "rest" = 강제 휴식 override.
 */
type Adjustment = 0 | 1 | 2 | "rest";

// injury × readiness 매트릭스. injury 우선 (부상 위험이 회복력보다 강한 신호).
const ADJUSTMENT_MATRIX: Record<InjuryLabel, Record<ReadinessLabel, Adjustment>> = {
  safe: {
    optimal: 0,
    good: 0,
    moderate: 0,
    fatigued: 1,
    depleted: "rest",
  },
  caution: {
    optimal: 0,
    good: 0,
    moderate: 1,
    fatigued: 1,
    depleted: "rest",
  },
  elevated: {
    optimal: 1,
    good: 1,
    moderate: 2,
    fatigued: "rest",
    depleted: "rest",
  },
  high: {
    optimal: "rest",
    good: "rest",
    moderate: "rest",
    fatigued: "rest",
    depleted: "rest",
  },
};

// 한 단계 downgrade. long 은 easy 로 강등 + 거리 60% 축소 (별도 처리 필요).
const DOWNGRADE_LADDER: Record<WorkoutType, WorkoutType> = {
  interval: "tempo",
  tempo: "easy",
  long: "easy",
  easy: "recovery",
  recovery: "rest",
  rest: "rest",
};

// downgrade 시 거리 배율 (long → easy 는 거리 축소).
const DOWNGRADE_DISTANCE_FACTOR: Partial<Record<WorkoutType, number>> = {
  long: 0.6,
};

// type 별 LTHR pace 배율 (M6-1 pace-calc.ts 와 일관).
const TYPE_TO_PACE_MULT: Record<WorkoutType, { mult: number; zone: string } | null> = {
  easy: { mult: 1.20, zone: "Z2" },
  long: { mult: 1.22, zone: "Z2" },
  tempo: { mult: 1.05, zone: "Z3-4" },
  interval: { mult: 0.95, zone: "Z5" },
  recovery: { mult: 1.30, zone: "Z1" },
  rest: null,
};

const PACE_RANGE_PCT = 0.05; // ±5%
const NULL_INJURY_DEFAULT: InjuryLabel = "safe";
const NULL_READINESS_DEFAULT: ReadinessLabel = "moderate";

function normalizeInjury(label: string | null): InjuryLabel {
  if (
    label === "safe" ||
    label === "caution" ||
    label === "elevated" ||
    label === "high"
  ) {
    return label;
  }
  return NULL_INJURY_DEFAULT;
}

function normalizeReadiness(label: string | null): ReadinessLabel {
  if (
    label === "optimal" ||
    label === "good" ||
    label === "moderate" ||
    label === "fatigued" ||
    label === "depleted"
  ) {
    return label;
  }
  return NULL_READINESS_DEFAULT;
}

function stepDowngrade(type: WorkoutType, steps: number): WorkoutType {
  let cur = type;
  for (let i = 0; i < steps; i++) {
    const next = DOWNGRADE_LADDER[cur];
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

function computePaceRange(
  paceSecPerKm: number
): { min: string; max: string } {
  const delta = paceSecPerKm * PACE_RANGE_PCT;
  const minSec = Math.round(paceSecPerKm - delta);
  const maxSec = Math.round(paceSecPerKm + delta);
  return { min: formatPace(minSec), max: formatPace(maxSec) };
}

function recalcForType(
  newType: WorkoutType,
  baseDistanceKm: number | null,
  baseType: WorkoutType,
  lthrPaceSecPerKm: number | null
): {
  distanceKm: number | null;
  paceSecPerKm: number | null;
  zone: string | null;
  intervalDesc: string | null;
} {
  if (newType === "rest") {
    return { distanceKm: null, paceSecPerKm: null, zone: null, intervalDesc: null };
  }
  const paceConf = TYPE_TO_PACE_MULT[newType];
  const paceSecPerKm =
    paceConf !== null && lthrPaceSecPerKm !== null
      ? Math.round(lthrPaceSecPerKm * paceConf.mult)
      : null;
  const zone = paceConf?.zone ?? null;
  // 거리: base 유지가 기본. long → easy 강등 시 60% 축소.
  const factor =
    baseType !== newType && DOWNGRADE_DISTANCE_FACTOR[baseType] !== undefined
      ? (DOWNGRADE_DISTANCE_FACTOR[baseType] as number)
      : 1;
  const distanceKm =
    baseDistanceKm !== null
      ? Math.round(baseDistanceKm * factor * 10) / 10
      : null;
  return { distanceKm, paceSecPerKm, zone, intervalDesc: null };
}

function rationaleFor(
  readinessLabel: ReadinessLabel,
  injuryLabel: InjuryLabel,
  baseType: WorkoutType,
  recommendedType: WorkoutType,
  readinessScore: number | null,
  injuryScore: number | null,
  missingReadiness: boolean,
  missingInjury: boolean
): string {
  const readinessDesc =
    missingReadiness
      ? "readiness 데이터 없음"
      : `readiness ${readinessScore ?? "?"} (${readinessLabel})`;
  const injuryDesc = missingInjury
    ? "부상 위험 데이터 없음"
    : `부상 위험 ${injuryScore ?? "?"} (${injuryLabel})`;

  const adjusted = baseType !== recommendedType;
  const action = adjusted
    ? `${baseType} 를 ${recommendedType} 로 조정.`
    : "계획대로 진행.";

  return `${readinessDesc} + ${injuryDesc} → ${action}`;
}

export interface AdjustInput {
  base: BaseWorkout;
  readinessScore: number | null;
  readinessLabel: string | null;
  injuryScore: number | null;
  injuryLabel: string | null;
  lthrPaceSecPerKm: number | null; // 재계산 시 사용
}

export interface AdjustOutput {
  recommendation: RecommendedWorkout;
  factors: {
    readiness: { score: number | null; label: string | null };
    injury: { score: number | null; label: string | null };
  };
  rationale: string;
}

/**
 * base workout 을 readiness + injury 로 조정.
 * Injury / readiness label 이 null 이면 안전한 기본값(safe / moderate) 로 취급하되,
 * rationale 에는 데이터 부재를 명시.
 */
export function adjustWorkout(input: AdjustInput): AdjustOutput {
  const missingReadiness = input.readinessLabel === null;
  const missingInjury = input.injuryLabel === null;
  const readinessLabel = normalizeReadiness(input.readinessLabel);
  const injuryLabel = normalizeInjury(input.injuryLabel);
  const adjustment = ADJUSTMENT_MATRIX[injuryLabel][readinessLabel];

  let recommendedType: WorkoutType;
  if (adjustment === "rest") {
    recommendedType = "rest";
  } else if (adjustment === 0) {
    recommendedType = input.base.type;
  } else {
    recommendedType = stepDowngrade(input.base.type, adjustment);
  }

  const recalced = recalcForType(
    recommendedType,
    input.base.distanceKm,
    input.base.type,
    input.lthrPaceSecPerKm
  );

  const paceRange =
    recalced.paceSecPerKm !== null
      ? computePaceRange(recalced.paceSecPerKm)
      : null;

  const adjusted = input.base.type !== recommendedType;
  // 사용자 노출 문자열은 한국어 (rationale 과 언어 일치).
  const adjustmentReason = adjusted
    ? adjustment === "rest"
      ? "부상 위험 높음 또는 회복력 고갈"
      : `readiness ${readinessLabel} + 부상 위험 ${injuryLabel}`
    : null;

  return {
    recommendation: {
      type: recommendedType,
      distanceKm: recalced.distanceKm,
      paceRange,
      zone: recalced.zone,
      intervalDesc:
        recommendedType === "interval" ? input.base.intervalDesc : null,
      adjusted,
      adjustmentReason,
    },
    factors: {
      readiness: {
        score: input.readinessScore,
        label: input.readinessLabel,
      },
      injury: {
        score: input.injuryScore,
        label: input.injuryLabel,
      },
    },
    rationale: rationaleFor(
      readinessLabel,
      injuryLabel,
      input.base.type,
      recommendedType,
      input.readinessScore,
      input.injuryScore,
      missingReadiness,
      missingInjury
    ),
  };
}

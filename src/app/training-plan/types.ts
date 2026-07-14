// API 응답 형태 (compact JSON from MCP 도구).

import type { WorkoutType } from "./theme";

// M11 Phase 2 (#232): 목표 유형별 페이로드.
export type GoalType = "distance" | "time" | "endurance";

export interface TimeGoalPayload {
  distance: string; // "5K" | "10K" | "HM" | "FM"
  targetTimeSec: number;
  targetDate: string; // YYYY-MM-DD
}

export interface EnduranceGoalPayload {
  targetLongRunKm: number;
  targetDate?: string | null; // optional
}

export type GoalValuePayload = TimeGoalPayload | EnduranceGoalPayload | null;

export type WorkoutStatus =
  | "completed"
  | "missed"
  | "pending"
  | "rest";

export interface RecommendPayload {
  date: string;
  base: {
    source: "plan" | "fallback";
    type: WorkoutType;
    distanceKm?: number;
    pace?: string;
    zone?: string;
    intervalDesc?: string;
    planId?: string;
  };
  recommendation: {
    type: WorkoutType;
    distanceKm?: number;
    paceRange?: { min: string; max: string };
    zone?: string;
    intervalDesc?: string;
    adjusted: boolean;
    adjustmentReason?: string;
  };
  factors: {
    readiness: { score: number | null; label: string | null };
    injury: { score: number | null; label: string | null };
    plan: {
      hasActivePlan: boolean;
      todayWorkoutExists: boolean;
      todayIsRestPlanned: boolean;
      lthrPaceSource: "profile" | "pseudo" | "default";
    };
  };
  rationale: string;
}

export interface ActivePlanWorkout {
  date: string;
  type: WorkoutType;
  distanceKm: number | null;
  pace: string | null;
  zone: string | null;
  status: WorkoutStatus;
  matched?: { distanceKm: number; actualPace: string | null };
}

export interface ActivePlanPayload {
  plan: {
    planId: string;
    startDate: string;
    endDate: string;
    weekCount: number; // M11 Phase 1: 4 ~ 24 (기존 record 는 4 로 백필됨)
    weeklyFrequency: number;
    goalType: GoalType; // M11 Phase 2: 기본 "distance"
    goalValue?: GoalValuePayload;
    targetDistance?: string;
    targetDate?: string;
  } | null;
  progress?: {
    total: number;
    completed: number;
    missed: number;
    pending: number;
    completionPct: number;
  };
  todayWorkout?: ActivePlanWorkout;
  workouts?: ActivePlanWorkout[];
}

export interface HistoryItem {
  planId: string;
  startDate: string;
  endDate: string;
  weekCount: number;
  weeklyFrequency: number;
  goalType: GoalType;
  goalValue: unknown; // 유형별 JSON payload (null 가능) - 소비자가 goalType 으로 좁혀 사용.
  targetDistance: string | null;
  targetDate: string | null;
  totalActive: number;
  completed: number;
  completionPct: number;
  createdAt: string;
}

export interface HistoryPayload {
  items: HistoryItem[];
}

// API 응답 형태 (compact JSON from MCP 도구).

import type { WorkoutType } from "./theme";

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
    weeklyFrequency: number;
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
  weeklyFrequency: number;
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

// M6-4: recommend_today_workout MCP 도구.
// active plan 오늘 workout + readiness + injury risk 를 결정적으로 통합해
// 오늘 실제로 뛸 workout 을 단일 응답으로 반환. Read-only (DB write 없음).

import prisma from "../prisma";
import { todayKST, todayKSTString, ymdKST } from "../../lib/garmin/utils";
import { formatPace } from "./running-buckets";
import { computeBaseline } from "../../lib/training/baseline";
import {
  DEFAULT_FALLBACK_LTHR_PACE_SEC_PER_KM,
} from "../../lib/training/plan-generator";
import { pseudoLthrPace, paceZoneFor } from "../../lib/training/pace-calc";
import {
  adjustWorkout,
  type BaseWorkout,
} from "../../lib/training/workout-recommender";
import { getReadinessScore } from "./readiness";
import { getInjuryRiskScore } from "./injury-risk";
import type { WorkoutType } from "../../lib/training/workout-patterns";

const FALLBACK_EASY_VOLUME_RATIO = 0.2; // 주간 baseline × 0.2 = fallback easy 거리

interface DailySummaryLike {
  label?: string | null;
  score?: number | null;
}

function extractLabelAndScore(text: string): DailySummaryLike {
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    const label =
      typeof obj.label === "string" ? obj.label : null;
    const score = typeof obj.score === "number" ? obj.score : null;
    return { label, score };
  } catch {
    return { label: null, score: null };
  }
}

/** UserProfile lthrPace + baseline 재계산 → 최종 LTHR pace (fallback 로직 포함). */
async function resolveLthrPace(): Promise<{
  lthrPaceSecPerKm: number;
  baselineWeeklyKm: number;
  source: "profile" | "pseudo" | "default";
}> {
  const profile = await prisma.userProfile.findFirst({
    select: { lthrPace: true },
  });
  const baseline = await computeBaseline();
  if (profile?.lthrPace) {
    return {
      lthrPaceSecPerKm: profile.lthrPace,
      baselineWeeklyKm: baseline.weeklyKm,
      source: "profile",
    };
  }
  if (baseline.recentAvgPace !== null) {
    return {
      lthrPaceSecPerKm: pseudoLthrPace(baseline.recentAvgPace),
      baselineWeeklyKm: baseline.weeklyKm,
      source: "pseudo",
    };
  }
  return {
    lthrPaceSecPerKm: DEFAULT_FALLBACK_LTHR_PACE_SEC_PER_KM,
    baselineWeeklyKm: baseline.weeklyKm,
    source: "default",
  };
}

async function fetchTodayPlanWorkout(): Promise<{
  planId: string;
  type: WorkoutType;
  distanceKm: number | null;
  paceSecPerKm: number | null;
  zone: string | null;
  intervalDesc: string | null;
} | null> {
  const todayStr = todayKSTString();
  // @db.Date 컬럼은 UTC midnight 로 저장 → 오늘 KST 벽시계 날짜를 UTC midnight 으로 변환해 매칭.
  const todayUtcDate = new Date(`${todayStr}T00:00:00.000Z`);
  const workout = await prisma.trainingWorkout.findFirst({
    where: {
      date: todayUtcDate,
      plan: { status: "active" },
    },
    select: {
      planId: true,
      type: true,
      distanceKm: true,
      paceSecPerKm: true,
      zone: true,
      intervalDesc: true,
    },
  });
  if (!workout) return null;
  return {
    planId: workout.planId,
    type: workout.type as WorkoutType,
    distanceKm: workout.distanceKm,
    paceSecPerKm: workout.paceSecPerKm,
    zone: workout.zone,
    intervalDesc: workout.intervalDesc,
  };
}

function fallbackBase(
  lthrPaceSecPerKm: number,
  baselineWeeklyKm: number
): BaseWorkout {
  const distanceKm =
    Math.round(baselineWeeklyKm * FALLBACK_EASY_VOLUME_RATIO * 10) / 10;
  const pz = paceZoneFor("easy", lthrPaceSecPerKm);
  return {
    source: "fallback",
    type: "easy",
    distanceKm,
    paceSecPerKm: pz?.paceSecPerKm ?? null,
    zone: pz?.zone ?? null,
    intervalDesc: null,
  };
}

interface FactorsPayload {
  readiness: { score: number | null; label: string | null };
  injury: { score: number | null; label: string | null };
  plan: {
    hasActivePlan: boolean;
    todayIsRestPlanned: boolean;
    lthrPaceSource: "profile" | "pseudo" | "default";
  };
}

export async function recommendTodayWorkout() {
  const [readinessResult, injuryResult, planWorkout, lthr] = await Promise.all([
    getReadinessScore(),
    getInjuryRiskScore(),
    fetchTodayPlanWorkout(),
    resolveLthrPace(),
  ]);

  const readiness = extractLabelAndScore(
    readinessResult.content[0]?.text ?? "{}"
  );
  const injury = extractLabelAndScore(injuryResult.content[0]?.text ?? "{}");

  const todayIsRestPlanned = planWorkout?.type === "rest";
  const hasActivePlan = planWorkout !== null;

  // Base: plan 오늘 workout (rest 포함) → 그대로. plan 없으면 fallback.
  const base: BaseWorkout =
    planWorkout !== null
      ? {
          source: "plan",
          type: planWorkout.type,
          distanceKm: planWorkout.distanceKm,
          paceSecPerKm: planWorkout.paceSecPerKm,
          zone: planWorkout.zone,
          intervalDesc: planWorkout.intervalDesc,
          planId: planWorkout.planId,
        }
      : fallbackBase(lthr.lthrPaceSecPerKm, lthr.baselineWeeklyKm);

  const adjustment = adjustWorkout({
    base,
    readinessScore: readiness.score ?? null,
    readinessLabel: readiness.label ?? null,
    injuryScore: injury.score ?? null,
    injuryLabel: injury.label ?? null,
    lthrPaceSecPerKm: lthr.lthrPaceSecPerKm,
  });

  const basePayload: Record<string, unknown> = {
    source: base.source,
    type: base.type,
  };
  if (base.distanceKm !== null) basePayload.distanceKm = base.distanceKm;
  if (base.paceSecPerKm !== null)
    basePayload.pace = formatPace(base.paceSecPerKm);
  if (base.zone !== null) basePayload.zone = base.zone;
  if (base.intervalDesc !== null) basePayload.intervalDesc = base.intervalDesc;
  if (base.planId) basePayload.planId = base.planId;

  const factors: FactorsPayload = {
    readiness: adjustment.factors.readiness,
    injury: adjustment.factors.injury,
    plan: {
      hasActivePlan,
      todayIsRestPlanned,
      lthrPaceSource: lthr.source,
    },
  };

  // recommendation 은 null 필드 제거해 compact.
  const rec: Record<string, unknown> = {
    type: adjustment.recommendation.type,
    adjusted: adjustment.recommendation.adjusted,
  };
  if (adjustment.recommendation.distanceKm !== null)
    rec.distanceKm = adjustment.recommendation.distanceKm;
  if (adjustment.recommendation.paceRange !== null)
    rec.paceRange = adjustment.recommendation.paceRange;
  if (adjustment.recommendation.zone !== null)
    rec.zone = adjustment.recommendation.zone;
  if (adjustment.recommendation.intervalDesc !== null)
    rec.intervalDesc = adjustment.recommendation.intervalDesc;
  if (adjustment.recommendation.adjustmentReason !== null)
    rec.adjustmentReason = adjustment.recommendation.adjustmentReason;

  const payload = {
    date: ymdKST(todayKST()),
    base: basePayload,
    recommendation: rec,
    factors,
    rationale: adjustment.rationale,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}

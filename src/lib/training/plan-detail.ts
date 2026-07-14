// M7-2: 특정 plan (active or archived) 상세 조회 + 진행률 재계산.
// PlanCalendar 재사용을 위해 M6-1 getActiveTrainingPlan 응답과 동일한 shape.

import prisma from "@/lib/prisma";
import { ymdKST } from "@/lib/garmin/utils";
import { formatPace } from "@/mcp/tools/running-buckets";
import type { WorkoutType } from "@/app/training-plan/theme";
import type { WorkoutStatus } from "@/app/training-plan/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function dateOnlyToKstStart(dateOnly: Date): Date {
  return new Date(`${ymdKST(dateOnly)}T00:00:00+09:00`);
}

export interface PlanDetailWorkout {
  date: string;
  type: WorkoutType;
  distanceKm: number | null;
  pace: string | null;
  zone: string | null;
  status: WorkoutStatus;
  matched?: { distanceKm: number; actualPace: string | null };
}

export interface PlanDetailResponse {
  plan: {
    planId: string;
    status: "active" | "archived";
    startDate: string;
    endDate: string;
    weekCount: number;
    weeklyFrequency: number;
    goalType: string;
    goalValue: unknown;
    targetDistance: string | null;
    targetDate: string | null;
    baselineWeeklyKm: number | null;
    baselineAcwr: number | null;
    lthrPaceUsed: number | null;
    createdAt: string;
  };
  workouts: PlanDetailWorkout[];
  progress: {
    total: number;
    completed: number;
    missed: number;
    pending: number;
    completionPct: number;
  };
}

/**
 * planId 로 plan + workouts + 진행률 반환. archived plan 은 이후 재생성된
 * plan (successor) 의 createdAt 을 activity 매칭 창 상한으로 사용해 완료율이
 * 시간에 따라 변동되지 않게 고정.
 */
export async function fetchPlanDetail(
  planId: string
): Promise<PlanDetailResponse | null> {
  const plan = await prisma.trainingPlan.findUnique({
    where: { id: planId },
    include: {
      workouts: { orderBy: { date: "asc" } },
    },
  });
  if (!plan) return null;

  const planStart = dateOnlyToKstStart(plan.startDate);
  const planEndExclusive = new Date(
    dateOnlyToKstStart(plan.endDate).getTime() + DAY_MS
  );

  // Archived: successor createdAt 이 endDate 보다 이르면 그걸 상한으로.
  let effectiveEnd = planEndExclusive;
  if (plan.status === "archived") {
    const successor = await prisma.trainingPlan.findFirst({
      where: { createdAt: { gt: plan.createdAt } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    if (successor && successor.createdAt < planEndExclusive) {
      effectiveEnd = successor.createdAt;
    }
  }

  const activities = await prisma.activity.findMany({
    where: {
      startTime: { gte: planStart, lt: effectiveEnd },
      activityType: { contains: "running" },
      distance: { not: null },
    },
    select: { startTime: true, distance: true, avgPace: true },
    orderBy: { startTime: "asc" },
  });

  const byDate = new Map<string, { distanceKm: number; avgPace: number | null }[]>();
  for (const a of activities) {
    const key = ymdKST(a.startTime);
    const entry = { distanceKm: (a.distance ?? 0) / 1000, avgPace: a.avgPace };
    const list = byDate.get(key);
    if (list) list.push(entry);
    else byDate.set(key, [entry]);
  }

  // cutoffStr = effectiveEnd 의 KST 벽 날짜 (exclusive lower bound 의 KST 표현).
  // 이 날 workout 은 byDate 에 이미 있는 activity 로 매칭 시도 (successor 생성 이전 활동).
  // 이후 날짜만 pending. plan-history.ts 의 매칭 방식과 정합 → ArchivedList 완료율과 일치.
  const cutoffStr = ymdKST(effectiveEnd);

  const rows: PlanDetailWorkout[] = [];
  let completed = 0;
  let missed = 0;
  let pending = 0;

  for (const w of plan.workouts) {
    const dateStr = ymdKST(w.date);
    const row: PlanDetailWorkout = {
      date: dateStr,
      type: w.type as WorkoutType,
      distanceKm: w.distanceKm,
      pace: w.paceSecPerKm !== null ? formatPace(w.paceSecPerKm) : null,
      zone: w.zone,
      status: "pending",
    };

    if (w.type === "rest") {
      row.status = "rest";
    } else if (dateStr > cutoffStr) {
      pending++;
      row.status = "pending";
    } else {
      const matches = byDate.get(dateStr) ?? [];
      const plannedKm = w.distanceKm ?? 0;
      const threshold = plannedKm * 0.9;
      const sufficient = matches.filter((m) => m.distanceKm >= threshold);
      const pick =
        sufficient.length > 0
          ? sufficient.reduce((a, b) => (a.distanceKm >= b.distanceKm ? a : b))
          : null;
      if (pick) {
        completed++;
        row.status = "completed";
        row.matched = {
          distanceKm: Math.round(pick.distanceKm * 100) / 100,
          actualPace: pick.avgPace !== null ? formatPace(pick.avgPace) : null,
        };
      } else {
        missed++;
        row.status = "missed";
      }
    }
    rows.push(row);
  }

  const totalActive = completed + missed + pending;
  const completionPct =
    totalActive > 0 ? Math.round((completed / totalActive) * 1000) / 10 : 0;

  return {
    plan: {
      planId: plan.id,
      status: plan.status as "active" | "archived",
      startDate: ymdKST(plan.startDate),
      endDate: ymdKST(plan.endDate),
      weekCount: plan.weekCount,
      weeklyFrequency: plan.weeklyFrequency,
      goalType: plan.goalType,
      goalValue: plan.goalValue ?? null,
      targetDistance: plan.targetDistance ?? null,
      targetDate:
        plan.targetDate !== null ? ymdKST(plan.targetDate) : null,
      baselineWeeklyKm: plan.baselineWeeklyKm,
      baselineAcwr: plan.baselineAcwr,
      lthrPaceUsed:
        plan.lthrPaceUsed !== null ? Math.round(plan.lthrPaceUsed) : null,
      createdAt: plan.createdAt.toISOString(),
    },
    workouts: rows,
    progress: {
      total: totalActive,
      completed,
      missed,
      pending,
      completionPct,
    },
  };
}

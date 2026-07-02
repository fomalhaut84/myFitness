// Archived plan 이력 조회 + 완료율 재계산 공용 helper.
// src/app/training-plan/page.tsx (SSR) 와 src/app/api/training-plan/history/route.ts 가 공유.

import prisma from "../../mcp/prisma";
import { ymdKST } from "../garmin/utils";

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_LIMIT = 20;

function dateOnlyToKstStart(dateOnly: Date): Date {
  return new Date(`${ymdKST(dateOnly)}T00:00:00+09:00`);
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

export async function fetchArchivedHistory(): Promise<HistoryItem[]> {
  const plans = await prisma.trainingPlan.findMany({
    where: { status: "archived" },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
    include: {
      workouts: { select: { date: true, type: true, distanceKm: true } },
    },
  });

  return Promise.all(
    plans.map(async (plan) => {
      const planStart = dateOnlyToKstStart(plan.startDate);
      const planEnd = new Date(
        dateOnlyToKstStart(plan.endDate).getTime() + DAY_MS
      );
      const activities = await prisma.activity.findMany({
        where: {
          startTime: { gte: planStart, lt: planEnd },
          activityType: { contains: "running" },
          distance: { not: null },
        },
        select: { startTime: true, distance: true },
      });

      const byDate = new Map<string, number[]>();
      for (const a of activities) {
        const key = ymdKST(a.startTime);
        const distKm = (a.distance ?? 0) / 1000;
        const list = byDate.get(key);
        if (list) list.push(distKm);
        else byDate.set(key, [distKm]);
      }

      const active = plan.workouts.filter((w) => w.type !== "rest");
      let completed = 0;
      for (const w of active) {
        const dateStr = ymdKST(w.date);
        const matches = byDate.get(dateStr) ?? [];
        const threshold = (w.distanceKm ?? 0) * 0.9;
        if (matches.some((d) => d >= threshold)) completed++;
      }
      const completionPct =
        active.length > 0
          ? Math.round((completed / active.length) * 1000) / 10
          : 0;

      return {
        planId: plan.id,
        startDate: ymdKST(plan.startDate),
        endDate: ymdKST(plan.endDate),
        weeklyFrequency: plan.weeklyFrequency,
        targetDistance: plan.targetDistance ?? null,
        targetDate:
          plan.targetDate !== null ? ymdKST(plan.targetDate) : null,
        totalActive: active.length,
        completed,
        completionPct,
        createdAt: plan.createdAt.toISOString(),
      };
    })
  );
}

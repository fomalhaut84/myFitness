import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ymdKST } from "@/lib/garmin/utils";

// Archived plan 이력 (최신순 20개).
// 각 plan 의 완료율은 workouts 매칭 로직을 여기서 재계산하지 않고
// rest 제외 workout 총 수 + 지난 workout 중 실제 activity 매칭 수 기반으로 계산.

const HISTORY_LIMIT = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

function dateOnlyToKstStart(dateOnly: Date): Date {
  return new Date(`${ymdKST(dateOnly)}T00:00:00+09:00`);
}

export async function GET() {
  try {
    const plans = await prisma.trainingPlan.findMany({
      where: { status: "archived" },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
      include: {
        workouts: {
          select: { date: true, type: true, distanceKm: true },
        },
      },
    });

    const items = await Promise.all(
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

        // 완료율: rest 제외 workout 중 KST day 매칭 + 계획 90% 이상 거리 = completed.
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

    return NextResponse.json({ items });
  } catch (error) {
    console.error("[api/training-plan/history] 조회 실패:", error);
    return NextResponse.json(
      { error: "plan 이력 조회 중 서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

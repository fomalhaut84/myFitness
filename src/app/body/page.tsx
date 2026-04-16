import prisma from "@/lib/prisma";
import { formatDateLocal } from "@/lib/format";
import {
  movingAverage,
  summarizeWeek,
  computeGoalProgress,
} from "@/lib/fitness/weight-trend";
import BodyClient from "./body-client";

export const dynamic = "force-dynamic";

function daysAgoLocal(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default async function BodyPage() {
  const today = daysAgoLocal(0);
  const thirtyDaysAgo = daysAgoLocal(30);
  const sixtyDaysAgo = daysAgoLocal(60);

  const [latest, weightRecent, fatTrend, recentRecords, profile, balances, weeklyRuns, earliestWeight] =
    await Promise.all([
      prisma.bodyComposition.findFirst({ orderBy: { date: "desc" } }),
      prisma.bodyComposition.findMany({
        where: { date: { gte: sixtyDaysAgo } },
        select: { date: true, weight: true },
        orderBy: { date: "asc" },
      }),
      prisma.bodyComposition.findMany({
        where: { date: { gte: thirtyDaysAgo }, bodyFat: { not: null } },
        select: { date: true, bodyFat: true },
        orderBy: { date: "asc" },
      }),
      prisma.bodyComposition.findMany({
        where: { date: { gte: daysAgoLocal(14) } },
        orderBy: { date: "desc" },
        select: {
          date: true,
          weight: true,
          bmi: true,
          bodyFat: true,
          muscleMass: true,
        },
      }),
      prisma.userProfile.findFirst(),
      prisma.dailySummary.findMany({
        where: { date: { gte: daysAgoLocal(30) } },
        select: {
          date: true,
          calorieBalance: true,
          estimatedIntakeCalories: true,
          availableCalories: true,
          activeCalories: true,
        },
        orderBy: { date: "asc" },
      }),
      prisma.activity.findMany({
        where: {
          startTime: { gte: daysAgoLocal(56) },
          activityType: { contains: "running" },
        },
        select: { startTime: true, distance: true },
        orderBy: { startTime: "asc" },
      }),
      prisma.bodyComposition.findFirst({
        orderBy: { date: "asc" },
        select: { weight: true, date: true },
      }),
    ]);

  // 체중 이동평균 7일
  const weightRecords = weightRecent.map((r) => ({
    date: r.date,
    weight: r.weight,
  }));
  const weightMA7 = movingAverage(weightRecords, 7);
  const weightMA14 = movingAverage(weightRecords, 14);

  // 최근 30일 칼로리 밸런스 일별
  const calorieSeries = balances.map((b) => ({
    date: formatDateLocal(b.date),
    intake: b.estimatedIntakeCalories,
    available: b.availableCalories,
    balance: b.calorieBalance,
    active: b.activeCalories,
  }));

  // 주간 요약 (최근 4주)
  const weeklySummaries = [];
  for (let i = 0; i < 4; i++) {
    const weekEnd = daysAgoLocal(i * 7);
    const weekStart = daysAgoLocal(i * 7 + 7);
    weeklySummaries.push(
      summarizeWeek({
        balances,
        weights: weightRecords,
        weekStart,
        weekEnd,
      })
    );
  }

  // 주간 러닝 거리 (최근 8주)
  const weeklyDistances: { weekLabel: string; distanceKm: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const weekStart = daysAgoLocal(i * 7 + 6);
    const weekEnd = daysAgoLocal(i * 7 - 1);
    const weekRuns = weeklyRuns.filter(
      (r) =>
        r.startTime.getTime() >= weekStart.getTime() &&
        r.startTime.getTime() <= weekEnd.getTime()
    );
    const totalMeters = weekRuns.reduce((s, r) => s + (r.distance ?? 0), 0);
    weeklyDistances.push({
      weekLabel: formatDateLocal(weekStart).slice(5), // MM-DD
      distanceKm: Number((totalMeters / 1000).toFixed(1)),
    });
  }

  // 목표 진행도
  const goalProgress = computeGoalProgress({
    currentWeight: latest?.weight ?? null,
    startWeight: earliestWeight?.weight ?? null,
    targetWeight: profile?.targetWeight ?? null,
  });

  return (
    <BodyClient
      latestWeight={latest?.weight ?? null}
      latestBMI={latest?.bmi ?? null}
      latestBodyFat={latest?.bodyFat ?? null}
      weightTrend={weightRecords
        .filter((r) => r.date.getTime() >= thirtyDaysAgo.getTime())
        .map((r) => ({
          date: formatDateLocal(r.date),
          value: r.weight,
        }))}
      weightMA7={weightMA7
        .filter((p) => p.date.getTime() >= thirtyDaysAgo.getTime())
        .map((p) => ({
          date: formatDateLocal(p.date),
          value: p.avg,
        }))}
      weightMA14={weightMA14
        .filter((p) => p.date.getTime() >= thirtyDaysAgo.getTime())
        .map((p) => ({
          date: formatDateLocal(p.date),
          value: p.avg,
        }))}
      fatTrend={fatTrend.map((r) => ({
        date: formatDateLocal(r.date),
        value: r.bodyFat,
      }))}
      recentRecords={recentRecords.map((r) => ({
        date: formatDateLocal(r.date),
        weight: r.weight,
        bmi: r.bmi,
        bodyFat: r.bodyFat,
        muscleMass: r.muscleMass,
      }))}
      calorieSeries={calorieSeries}
      weeklySummaries={weeklySummaries.map((s) => ({
        weekStartLabel: formatDateLocal(s.weekStart),
        weekEndLabel: formatDateLocal(
          new Date(s.weekEnd.getTime() - 1)
        ),
        avgDailyBalance: s.avgDailyBalance,
        projectedLossKg: s.projectedLossKg,
        weightChangeKg: s.weightChangeKg,
        daysWithData: s.daysWithData,
      }))}
      weeklyDistances={weeklyDistances}
      goalProgress={{
        currentWeight: latest?.weight ?? null,
        targetWeight: profile?.targetWeight ?? null,
        targetDate: profile?.targetDate
          ? formatDateLocal(profile.targetDate)
          : null,
        remainingKg: goalProgress.remainingKg,
        lostKg: goalProgress.lostKg,
        percentComplete: goalProgress.percentComplete,
      }}
      todayDate={formatDateLocal(today)}
    />
  );
}

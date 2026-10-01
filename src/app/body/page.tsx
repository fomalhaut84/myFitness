import prisma from "@/lib/prisma";
import { formatDateLocal, formatDayBefore } from "@/lib/format";
// #365 (사전 리뷰 major 1): 서버 로컬 자정 (`setHours(0,0,0,0)`) 대신 KST 자정 instant — 조회 경계 · 주간 라벨이 호스트 TZ 와 무관
import { daysAgoKST } from "@/lib/garmin/utils";
import {
  movingAverage,
  summarizeWeek,
  computeGoalProgress,
} from "@/lib/fitness/weight-trend";
import { resolveBmi } from "@/lib/fitness/bmi";
import BodyClient from "./body-client";

export const dynamic = "force-dynamic";

export default async function BodyPage() {
  const today = daysAgoKST(0);
  const thirtyDaysAgo = daysAgoKST(30);
  const sixtyDaysAgo = daysAgoKST(60);

  const [latest, weightRecent, fatTrend, recentRecords, profile, balances, weeklyRuns, maxWeightRecord] =
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
        where: { date: { gte: daysAgoKST(14) } },
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
        where: { date: { gte: daysAgoKST(30) } },
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
          startTime: { gte: daysAgoKST(56) },
          activityType: { contains: "running" },
        },
        select: { startTime: true, distance: true },
        orderBy: { startTime: "asc" },
      }),
      // 감량 시작점: 전 기간 중 가장 높았던 체중 (earliest가 아닌 max)
      prisma.bodyComposition.findFirst({
        orderBy: { weight: "desc" },
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
    const weekEnd = daysAgoKST(i * 7);
    const weekStart = daysAgoKST(i * 7 + 7);
    weeklySummaries.push(
      summarizeWeek({
        balances,
        weights: weightRecords,
        weekStart,
        weekEnd,
      })
    );
  }

  // 주간 러닝 거리 (최근 8주). weekStart(inclusive) ~ weekEnd(exclusive)로 경계 중복 방지.
  const weeklyDistances: { weekLabel: string; distanceKm: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const weekStart = daysAgoKST(i * 7 + 6);
    const weekEndExclusive = daysAgoKST(i * 7 - 1); // 다음 주 시작 (미포함)
    const weekRuns = weeklyRuns.filter(
      (r) =>
        r.startTime.getTime() >= weekStart.getTime() &&
        r.startTime.getTime() < weekEndExclusive.getTime()
    );
    const totalMeters = weekRuns.reduce((s, r) => s + (r.distance ?? 0), 0);
    weeklyDistances.push({
      weekLabel: formatDateLocal(weekStart).slice(5), // MM-DD
      distanceKm: Number((totalMeters / 1000).toFixed(1)),
    });
  }

  // 목표 진행도 (startWeight = 전 기간 최고 체중을 감량 시작점으로 사용)
  const goalProgress = computeGoalProgress({
    currentWeight: latest?.weight ?? null,
    startWeight: maxWeightRecord?.weight ?? null,
    targetWeight: profile?.targetWeight ?? null,
  });

  return (
    <BodyClient
      latestWeight={latest?.weight ?? null}
      latestBMI={latest ? resolveBmi(latest.bmi, latest.weight, profile?.height) : null}
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
        bmi: resolveBmi(r.bmi, r.weight, profile?.height),
        bodyFat: r.bodyFat,
        muscleMass: r.muscleMass,
      }))}
      calorieSeries={calorieSeries}
      weeklySummaries={weeklySummaries.map((s) => ({
        weekStartLabel: formatDateLocal(s.weekStart),
        // weekEnd 는 KST 자정 (exclusive) → 라벨은 그 전날. `−1ms` 는 UTC 호스트에서 KST 로 읽으면 같은 날이 된다 (사전 리뷰 major 1)
        weekEndLabel: formatDayBefore(s.weekEnd),
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

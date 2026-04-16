import prisma from "@/lib/prisma";
import { formatDateLocal } from "@/lib/format";
import DashboardClient from "./dashboard-client";

function todayLocal(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysAgoLocal(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const today = todayLocal();
  const yesterday = daysAgoLocal(1);
  const weekAgo = daysAgoLocal(6);
  const thirtyDaysAgo = daysAgoLocal(29);

  const [todaySummary, yesterdaySummary, todaySleep, yesterdaySleep] =
    await Promise.all([
      prisma.dailySummary.findUnique({ where: { date: today } }),
      prisma.dailySummary.findUnique({ where: { date: yesterday } }),
      prisma.sleepRecord.findUnique({ where: { date: today } }),
      prisma.sleepRecord.findUnique({ where: { date: yesterday } }),
    ]);

  const [weeklySteps, weeklyHR] = await Promise.all([
    prisma.dailySummary.findMany({
      where: { date: { gte: weekAgo, lte: today } },
      select: { date: true, steps: true },
      orderBy: { date: "asc" },
    }),
    prisma.heartRateRecord.findMany({
      where: { date: { gte: weekAgo, lte: today } },
      select: { date: true, restingHR: true },
      orderBy: { date: "asc" },
    }),
  ]);

  // 30일 추세 데이터
  const monthlyStats = await prisma.dailySummary.findMany({
    where: { date: { gte: thirtyDaysAgo, lte: today } },
    select: {
      date: true,
      steps: true,
      activeCalories: true,
      avgStress: true,
      bodyBattery: true,
      avgSpo2: true,
      stressHighDuration: true,
      stressMediumDuration: true,
      stressLowDuration: true,
    },
    orderBy: { date: "asc" },
  });

  const recentActivities = await prisma.activity.findMany({
    take: 5,
    orderBy: { startTime: "desc" },
    select: {
      id: true,
      name: true,
      activityType: true,
      startTime: true,
      duration: true,
      distance: true,
      avgPace: true,
      calories: true,
    },
  });

  const todayData = {
    steps: todaySummary?.steps ?? null,
    restingHR: todaySummary?.restingHR ?? null,
    sleepScore: todaySleep?.sleepScore ?? null,
    bodyBattery: todaySummary?.bodyBattery ?? null,
    spo2: todaySleep?.avgSpO2 ?? todaySummary?.avgSpo2 ?? null,
    intakeCalories: todaySummary?.estimatedIntakeCalories ?? null,
    availableCalories: todaySummary?.availableCalories ?? null,
    calorieBalance: todaySummary?.calorieBalance ?? null,
    activeCalories: todaySummary?.activeCalories ?? null,
  };

  const yesterdayData = {
    steps: yesterdaySummary?.steps ?? null,
    restingHR: yesterdaySummary?.restingHR ?? null,
    sleepScore: yesterdaySleep?.sleepScore ?? null,
    bodyBattery: yesterdaySummary?.bodyBattery ?? null,
    spo2: yesterdaySleep?.avgSpO2 ?? yesterdaySummary?.avgSpo2 ?? null,
    intakeCalories: yesterdaySummary?.estimatedIntakeCalories ?? null,
    availableCalories: yesterdaySummary?.availableCalories ?? null,
    calorieBalance: yesterdaySummary?.calorieBalance ?? null,
    activeCalories: yesterdaySummary?.activeCalories ?? null,
  };

  // 오늘 최신 리포트 (KST 기준, daily-report.ts와 동일 방식)
  const kstNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const todayDateStr = `${kstNow.getFullYear()}-${String(kstNow.getMonth() + 1).padStart(2, "0")}-${String(kstNow.getDate()).padStart(2, "0")}`;
  const latestReport = await prisma.aIAdvice.findFirst({
    where: {
      category: { in: ["morning_report", "evening_report"] },
      reportDate: todayDateStr,
    },
    orderBy: { createdAt: "desc" },
    select: { category: true, response: true, createdAt: true },
  });

  return (
    <DashboardClient
      today={todayData}
      yesterday={yesterdayData}
      latestReport={latestReport ? {
        category: latestReport.category,
        response: latestReport.response,
        createdAt: latestReport.createdAt.toISOString(),
      } : null}
      weeklySteps={weeklySteps.map((d) => ({
        date: formatDateLocal(d.date),
        value: d.steps,
      }))}
      weeklyHR={weeklyHR.map((d) => ({
        date: formatDateLocal(d.date),
        value: d.restingHR,
      }))}
      recentActivities={recentActivities.map((a) => ({
        id: a.id,
        name: a.name,
        activityType: a.activityType,
        startTime: a.startTime.toISOString(),
        duration: a.duration,
        distance: a.distance,
        avgPace: a.avgPace,
        calories: a.calories,
      }))}
      monthlySteps={monthlyStats.map((d) => ({
        date: formatDateLocal(d.date),
        value: d.steps,
      }))}
      monthlyCalories={monthlyStats.map((d) => ({
        date: formatDateLocal(d.date),
        value: d.activeCalories,
      }))}
      monthlyStress={monthlyStats.map((d) => ({
        date: formatDateLocal(d.date),
        value: d.avgStress,
      }))}
      monthlyBodyBattery={monthlyStats.map((d) => ({
        date: formatDateLocal(d.date),
        value: d.bodyBattery,
      }))}
      monthlySpo2={monthlyStats.map((d) => ({
        date: formatDateLocal(d.date),
        value: d.avgSpo2,
      }))}
      monthlyStressDetail={monthlyStats.map((d) => ({
        date: formatDateLocal(d.date),
        high: d.stressHighDuration,
        medium: d.stressMediumDuration,
        low: d.stressLowDuration,
      }))}
    />
  );
}

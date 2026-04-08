import prisma from "@/lib/prisma";
import { formatDateLocal } from "@/lib/format";
import ActivitiesClient from "./activities-client";

export const dynamic = "force-dynamic";

function weeksAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d;
}

export default async function ActivitiesPage() {
  const now = new Date();
  // KST 기준 월 시작 (UTC로 저장된 DB와 비교 가능하도록)
  const kstNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const monthStart = new Date(Date.UTC(kstNow.getFullYear(), kstNow.getMonth(), 1) - 9 * 60 * 60 * 1000);
  const eightWeeksAgo = weeksAgo(8);

  // 최대 심박수 추정 (UserProfile 나이 기반 또는 실측 maxHR)
  const userProfile = await prisma.userProfile.findFirst();
  const estimatedMaxHR = userProfile?.birthDate
    ? 220 - Math.floor((Date.now() - userProfile.birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : 190;

  const activities = await prisma.activity.findMany({
    orderBy: { startTime: "desc" },
    take: 20,
    select: {
      id: true,
      name: true,
      activityType: true,
      startTime: true,
      duration: true,
      distance: true,
      avgPace: true,
      avgHR: true,
      calories: true,
    },
  });

  // 이번 달 러닝 요약
  const monthlyRunning = await prisma.activity.findMany({
    where: {
      activityType: { contains: "running" },
      startTime: { gte: monthStart },
    },
    select: { distance: true, duration: true, avgPace: true },
  });

  const monthSummary = {
    count: monthlyRunning.length,
    totalDistance: monthlyRunning.reduce((sum, a) => sum + (a.distance ?? 0), 0),
    totalDuration: monthlyRunning.reduce((sum, a) => sum + a.duration, 0),
    avgPace: (() => {
      const withBoth = monthlyRunning.filter((a) => a.avgPace !== null && (a.distance ?? 0) > 0);
      if (withBoth.length === 0) return null;
      // 거리 가중 평균 페이스
      const totalDist = withBoth.reduce((s, a) => s + (a.distance ?? 0), 0);
      const totalTime = withBoth.reduce((s, a) => s + (a.avgPace! * ((a.distance ?? 0) / 1000)), 0);
      return totalTime / (totalDist / 1000);
    })(),
  };

  // 러닝 분석 (최근 30일)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const runningRecords = await prisma.activity.findMany({
    where: {
      activityType: { contains: "running" },
      startTime: { gte: thirtyDaysAgo },
    },
    orderBy: { startTime: "desc" },
    select: {
      startTime: true,
      avgPace: true,
      avgHR: true,
      maxHR: true,
      distance: true,
      trainingEffect: true,
      vo2maxEstimate: true,
    },
  });

  // 주간 볼륨 (8주)
  const allRecentRunning = await prisma.activity.findMany({
    where: {
      activityType: { contains: "running" },
      startTime: { gte: eightWeeksAgo },
    },
    select: { startTime: true, distance: true, duration: true },
    orderBy: { startTime: "asc" },
  });

  const weeklyVolumes: { weekLabel: string; distanceKm: number; count: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const wStart = startOfWeek(new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000));
    const wEnd = new Date(wStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    const weekRuns = allRecentRunning.filter(
      (a) => a.startTime >= wStart && a.startTime < wEnd
    );
    weeklyVolumes.push({
      weekLabel: `${wStart.getMonth() + 1}/${wStart.getDate()}`,
      distanceKm: Math.round(weekRuns.reduce((s, a) => s + (a.distance ?? 0), 0) / 100) / 10,
      count: weekRuns.length,
    });
  }

  // 오버트레이닝 위험 판단
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  const [recentHR, prevHR, recentSleep, prevSleep] = await Promise.all([
    prisma.heartRateRecord.findMany({
      where: { date: { gte: sevenDaysAgo } },
      select: { restingHR: true, hrvStatus: true },
    }),
    prisma.heartRateRecord.findMany({
      where: { date: { gte: fourteenDaysAgo, lt: sevenDaysAgo } },
      select: { restingHR: true, hrvStatus: true },
    }),
    prisma.sleepRecord.findMany({
      where: { date: { gte: sevenDaysAgo } },
      select: { sleepScore: true },
    }),
    prisma.sleepRecord.findMany({
      where: { date: { gte: fourteenDaysAgo, lt: sevenDaysAgo } },
      select: { sleepScore: true },
    }),
  ]);

  const avg = (arr: (number | null)[]) => {
    const valid = arr.filter((v): v is number => v !== null);
    return valid.length > 0 ? valid.reduce((s, v) => s + v, 0) / valid.length : null;
  };

  const recentAvgHR = avg(recentHR.map((r) => r.restingHR));
  const prevAvgHR = avg(prevHR.map((r) => r.restingHR));
  const recentAvgHRV = avg(recentHR.map((r) => r.hrvStatus));
  const prevAvgHRV = avg(prevHR.map((r) => r.hrvStatus));
  const recentAvgSleep = avg(recentSleep.map((r) => r.sleepScore));
  const prevAvgSleep = avg(prevSleep.map((r) => r.sleepScore));

  const hrRising = recentAvgHR !== null && prevAvgHR !== null && recentAvgHR - prevAvgHR >= 5;
  const hrvDropping = recentAvgHRV !== null && prevAvgHRV !== null && prevAvgHRV > 0
    && (prevAvgHRV - recentAvgHRV) / prevAvgHRV >= 0.2;
  const sleepDeclining = recentAvgSleep !== null && prevAvgSleep !== null && prevAvgSleep - recentAvgSleep >= 15;

  const riskCount = [hrRising, hrvDropping, sleepDeclining].filter(Boolean).length;
  const riskLevel = riskCount >= 2 ? "high" as const : riskCount === 1 ? "moderate" as const : "low" as const;

  return (
    <ActivitiesClient
      activities={activities.map((a) => ({
        ...a,
        startTime: a.startTime.toISOString(),
      }))}
      monthSummary={monthSummary}
      estimatedMaxHR={estimatedMaxHR}
      runningRecords={runningRecords.map((r) => ({
        date: formatDateLocal(r.startTime),
        avgPace: r.avgPace,
        avgHR: r.avgHR,
        maxHR: r.maxHR,
        distance: r.distance,
        trainingEffect: r.trainingEffect,
        vo2maxEstimate: r.vo2maxEstimate,
      }))}
      weeklyVolumes={weeklyVolumes}
      overtrainingRisk={{ hrRising, hrvDropping, sleepDeclining, riskLevel }}
    />
  );
}

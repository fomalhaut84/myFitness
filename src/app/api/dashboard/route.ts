import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

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

export async function GET() {
  try {
    const today = todayLocal();
    const yesterday = daysAgoLocal(1);
    const weekAgo = daysAgoLocal(6);

    const [todaySummary, yesterdaySummary, todaySleep, yesterdaySleep] =
      await Promise.all([
        prisma.dailySummary.findUnique({ where: { date: today } }),
        prisma.dailySummary.findUnique({ where: { date: yesterday } }),
        prisma.sleepRecord.findUnique({ where: { date: today } }),
        prisma.sleepRecord.findUnique({ where: { date: yesterday } }),
      ]);

    // 주간 데이터 (7일)
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

    // 최근 활동 5건
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

    return NextResponse.json({
      today: {
        steps: todaySummary?.steps ?? null,
        restingHR: todaySummary?.restingHR ?? null,
        sleepScore: todaySleep?.sleepScore ?? null,
        bodyBattery: todaySummary?.bodyBattery ?? null,
      },
      yesterday: {
        steps: yesterdaySummary?.steps ?? null,
        restingHR: yesterdaySummary?.restingHR ?? null,
        sleepScore: yesterdaySleep?.sleepScore ?? null,
        bodyBattery: yesterdaySummary?.bodyBattery ?? null,
      },
      weeklySteps: weeklySteps.map((d) => ({
        date: d.date.toISOString().split("T")[0],
        value: d.steps,
      })),
      weeklyHR: weeklyHR.map((d) => ({
        date: d.date.toISOString().split("T")[0],
        value: d.restingHR,
      })),
      recentActivities: recentActivities.map((a) => ({
        id: a.id,
        name: a.name,
        activityType: a.activityType,
        startTime: a.startTime.toISOString(),
        duration: a.duration,
        distance: a.distance,
        avgPace: a.avgPace,
        calories: a.calories,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

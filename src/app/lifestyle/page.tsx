import prisma from "@/lib/prisma";
import { formatDateLocal } from "@/lib/format";
import LifestyleClient from "./lifestyle-client";

export const dynamic = "force-dynamic";

function daysAgoLocal(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=일
  d.setDate(d.getDate() - day + 1); // 월요일 시작
  return d;
}

export default async function LifestylePage() {
  const now = new Date();
  const thisWeekStart = startOfWeek(now);
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  const twentyEightDaysAgo = daysAgoLocal(28);
  const fourteenDaysAgo = daysAgoLocal(14);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // 이번 주 / 지난 주 활동
  const [thisWeekActivities, lastWeekActivities] = await Promise.all([
    prisma.activity.findMany({
      where: { startTime: { gte: thisWeekStart } },
      select: { startTime: true, distance: true, duration: true },
    }),
    prisma.activity.findMany({
      where: {
        startTime: { gte: lastWeekStart, lt: thisWeekStart },
      },
      select: { startTime: true, distance: true, duration: true },
    }),
  ]);

  function summarizeWeek(activities: typeof thisWeekActivities, weekStart: Date) {
    const activeDates = new Set(
      activities.map((a) => formatDateLocal(a.startTime))
    );
    const daysInWeek = Math.min(
      7,
      Math.ceil((now.getTime() - weekStart.getTime()) / (1000 * 60 * 60 * 24))
    );
    return {
      count: activities.length,
      totalDistance: activities.reduce((s, a) => s + (a.distance ?? 0), 0),
      totalDuration: activities.reduce((s, a) => s + a.duration, 0),
      restDays: Math.max(0, daysInWeek - activeDates.size),
    };
  }

  // 월간 활동 날짜 (히트맵)
  const monthlyActivities = await prisma.activity.findMany({
    where: { startTime: { gte: monthStart } },
    select: { startTime: true },
  });
  const monthlyActiveDates = Array.from(
    new Set(monthlyActivities.map((a) => formatDateLocal(a.startTime)))
  );

  // 꾸준함 (28일)
  const last28Activities = await prisma.activity.findMany({
    where: { startTime: { gte: twentyEightDaysAgo } },
    select: { startTime: true },
  });
  const last28ActiveDates = new Set(
    last28Activities.map((a) => formatDateLocal(a.startTime))
  );

  // 수면 규칙성 (14일)
  const sleepRecords = await prisma.sleepRecord.findMany({
    where: { date: { gte: fourteenDaysAgo } },
    select: { date: true, sleepStart: true, sleepEnd: true },
    orderBy: { date: "asc" },
  });

  const sleepEntries = sleepRecords.map((r) => {
    const start = new Date(r.sleepStart);
    const end = new Date(r.sleepEnd);
    // 취침 시간을 소수점 시간으로 (자정 이후면 그대로, 이전이면 음수 방지를 위해 -24 안 함)
    let startHour = start.getHours() + start.getMinutes() / 60;
    // 22~24시를 음수로 변환하지 않고 그대로 유지
    if (startHour > 18) startHour = startHour - 24; // 예: 23시 → -1, 자정 기준 비교용
    const endHour = end.getHours() + end.getMinutes() / 60;

    return {
      date: formatDateLocal(r.date),
      sleepStartHour: startHour,
      wakeUpHour: endHour,
    };
  });

  return (
    <LifestyleClient
      thisWeek={summarizeWeek(thisWeekActivities, thisWeekStart)}
      lastWeek={summarizeWeek(lastWeekActivities, lastWeekStart)}
      monthlyActiveDates={monthlyActiveDates}
      year={now.getFullYear()}
      month={now.getMonth() + 1}
      consistencyActiveDays={last28ActiveDates.size}
      sleepEntries={sleepEntries}
    />
  );
}

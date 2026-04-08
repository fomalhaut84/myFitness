import prisma from "@/lib/prisma";
import { formatDateLocal } from "@/lib/format";
import SleepClient from "./sleep-client";

export const dynamic = "force-dynamic";

function daysAgoLocal(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default async function SleepPage() {
  const yesterday = daysAgoLocal(1);
  const thirtyDaysAgo = daysAgoLocal(30);

  const [lastNight, scoreHistory, recentRecords] = await Promise.all([
    prisma.sleepRecord.findUnique({ where: { date: yesterday } }),
    prisma.sleepRecord.findMany({
      where: { date: { gte: thirtyDaysAgo } },
      select: { date: true, sleepScore: true },
      orderBy: { date: "asc" },
    }),
    prisma.sleepRecord.findMany({
      where: { date: { gte: daysAgoLocal(14) } },
      orderBy: { date: "desc" },
      select: {
        date: true,
        totalSleep: true,
        sleepScore: true,
        deepSleep: true,
        lightSleep: true,
        remSleep: true,
        sleepStart: true,
        sleepEnd: true,
      },
    }),
  ]);

  return (
    <SleepClient
      lastNight={
        lastNight
          ? {
              totalSleep: lastNight.totalSleep,
              sleepScore: lastNight.sleepScore,
              deepSleep: lastNight.deepSleep,
              lightSleep: lastNight.lightSleep,
              remSleep: lastNight.remSleep,
              awakeDuration: lastNight.awakeDuration,
              sleepStart: lastNight.sleepStart.toISOString(),
              sleepEnd: lastNight.sleepEnd.toISOString(),
            }
          : null
      }
      scoreHistory={scoreHistory.map((r) => ({
        date: formatDateLocal(r.date),
        score: r.sleepScore,
      }))}
      recentRecords={recentRecords.map((r) => ({
        date: formatDateLocal(r.date),
        totalSleep: r.totalSleep,
        sleepScore: r.sleepScore,
        deepSleep: r.deepSleep,
        lightSleep: r.lightSleep,
        remSleep: r.remSleep,
        sleepStart: r.sleepStart.toISOString(),
        sleepEnd: r.sleepEnd.toISOString(),
      }))}
    />
  );
}

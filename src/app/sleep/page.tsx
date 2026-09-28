import prisma from "@/lib/prisma";
import { formatDateLocal } from "@/lib/format";
// #365: 서버 로컬 자정 (`setHours(0,0,0,0)`) 대신 KST 자정 instant — 조회 경계가 호스트 TZ 와 무관
import { daysAgoKST } from "@/lib/garmin/utils";
import SleepClient from "./sleep-client";

export const dynamic = "force-dynamic";

export default async function SleepPage() {
  const thirtyDaysAgo = daysAgoKST(30);

  const [lastNight, scoreHistory, recentRecords] = await Promise.all([
    prisma.sleepRecord.findFirst({ orderBy: { date: "desc" } }),
    prisma.sleepRecord.findMany({
      where: { date: { gte: thirtyDaysAgo } },
      select: { date: true, sleepScore: true },
      orderBy: { date: "asc" },
    }),
    prisma.sleepRecord.findMany({
      where: { date: { gte: daysAgoKST(14) } },
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

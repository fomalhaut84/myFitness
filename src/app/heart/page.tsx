import prisma from "@/lib/prisma";
import { formatDateLocal } from "@/lib/format";
import HeartClient from "./heart-client";

export const dynamic = "force-dynamic";

function daysAgoLocal(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default async function HeartPage() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thirtyDaysAgo = daysAgoLocal(30);
  const fourteenDaysAgo = daysAgoLocal(14);

  const [todayHR, hrTrend, hrvTrend, respirationTrend, recentRecords] = await Promise.all([
    prisma.heartRateRecord.findUnique({ where: { date: today } }),
    prisma.heartRateRecord.findMany({
      where: { date: { gte: thirtyDaysAgo } },
      select: { date: true, restingHR: true },
      orderBy: { date: "asc" },
    }),
    prisma.heartRateRecord.findMany({
      where: { date: { gte: thirtyDaysAgo } },
      select: { date: true, hrvStatus: true },
      orderBy: { date: "asc" },
    }),
    prisma.dailySummary.findMany({
      where: { date: { gte: thirtyDaysAgo } },
      select: { date: true, avgRespiration: true },
      orderBy: { date: "asc" },
    }),
    prisma.heartRateRecord.findMany({
      where: { date: { gte: fourteenDaysAgo } },
      orderBy: { date: "desc" },
      select: {
        date: true,
        restingHR: true,
        avgHR: true,
        maxHR: true,
        minHR: true,
        hrvStatus: true,
      },
    }),
  ]);

  return (
    <HeartClient
      todayRestingHR={todayHR?.restingHR ?? null}
      todayHRV={todayHR?.hrvStatus ?? null}
      hrTrend={hrTrend.map((r) => ({
        date: formatDateLocal(r.date),
        value: r.restingHR,
      }))}
      hrvTrend={hrvTrend.map((r) => ({
        date: formatDateLocal(r.date),
        value: r.hrvStatus ? Math.round(r.hrvStatus) : null,
      }))}
      respirationTrend={respirationTrend.map((r) => ({
        date: formatDateLocal(r.date),
        value: r.avgRespiration,
      }))}
      recentRecords={recentRecords.map((r) => ({
        date: formatDateLocal(r.date),
        restingHR: r.restingHR,
        avgHR: r.avgHR,
        maxHR: r.maxHR,
        minHR: r.minHR,
        hrvStatus: r.hrvStatus ? Math.round(r.hrvStatus) : null,
      }))}
    />
  );
}

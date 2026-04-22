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
  const thirtyDaysAgo = daysAgoLocal(29);
  const ninetyDaysAgo = daysAgoLocal(89);
  const fourteenDaysAgo = daysAgoLocal(14);

  const [
    todayHR,
    hrTrend,
    hrvTrend,
    respirationTrend,
    recentRecords,
    bpRecords,
    // 상관관계용: 수면, 스트레스, 바디배터리
    sleepForCorr,
    dailyForCorr,
  ] = await Promise.all([
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
      where: { date: { gte: thirtyDaysAgo, lte: today } },
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
    prisma.bloodPressure.findMany({
      where: { date: { gte: ninetyDaysAgo } },
      orderBy: { date: "asc" },
      select: {
        date: true,
        highSystolic: true,
        lowSystolic: true,
        highDiastolic: true,
        lowDiastolic: true,
        avgPulse: true,
        measureCount: true,
        category: true,
      },
    }),
    prisma.sleepRecord.findMany({
      where: { date: { gte: ninetyDaysAgo } },
      select: { date: true, sleepScore: true },
      orderBy: { date: "asc" },
    }),
    prisma.dailySummary.findMany({
      where: { date: { gte: ninetyDaysAgo } },
      select: {
        date: true,
        avgStress: true,
        bodyBatteryHigh: true,
        restingHR: true,
      },
      orderBy: { date: "asc" },
    }),
  ]);

  // 상관관계 데이터: 같은 날짜 조인
  const sleepMap = new Map(
    sleepForCorr.map((s) => [formatDateLocal(s.date), s.sleepScore])
  );
  const dailyMap = new Map(
    dailyForCorr.map((d) => [
      formatDateLocal(d.date),
      {
        stress: d.avgStress,
        battery: d.bodyBatteryHigh,
        restingHR: d.restingHR,
      },
    ])
  );

  const bpCorrelation = bpRecords.map((bp) => {
    const dateStr = formatDateLocal(bp.date);
    const daily = dailyMap.get(dateStr);
    return {
      date: dateStr,
      systolic: bp.highSystolic,
      diastolic: bp.highDiastolic,
      sleepScore: sleepMap.get(dateStr) ?? null,
      avgStress: daily?.stress ?? null,
      bodyBattery: daily?.battery ?? null,
      restingHR: daily?.restingHR ?? null,
    };
  });

  const latestBP = bpRecords.length > 0 ? bpRecords[bpRecords.length - 1] : null;

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
      latestBP={
        latestBP
          ? {
              date: formatDateLocal(latestBP.date),
              systolic: latestBP.highSystolic,
              diastolic: latestBP.highDiastolic,
              pulse: latestBP.avgPulse,
              category: latestBP.category,
            }
          : null
      }
      bpTrend={bpRecords.map((r) => ({
        date: formatDateLocal(r.date),
        systolic: r.highSystolic,
        diastolic: r.highDiastolic,
        pulse: r.avgPulse,
        category: r.category,
      }))}
      bpCorrelation={bpCorrelation}
    />
  );
}

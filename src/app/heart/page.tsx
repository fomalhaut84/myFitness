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

  // 차트/상관관계: midpoint로 대표값 (독립 극값 조합 방지)
  const bpCorrelation = bpRecords.map((bp) => {
    const dateStr = formatDateLocal(bp.date);
    const daily = dailyMap.get(dateStr);
    return {
      date: dateStr,
      systolic: Math.round((bp.highSystolic + bp.lowSystolic) / 2),
      diastolic: Math.round((bp.highDiastolic + bp.lowDiastolic) / 2),
      sleepScore: sleepMap.get(dateStr) ?? null,
      avgStress: daily?.stress ?? null,
      bodyBattery: daily?.battery ?? null,
      restingHR: daily?.restingHR ?? null,
    };
  });

  const latestBP = bpRecords.length > 0 ? bpRecords[bpRecords.length - 1] : null;
  // 측정 1회면 high=low=정확값. 다회면 midpoint로 대표값 표시 (독립 극값 조합 방지).
  const latestBPDisplay = latestBP
    ? {
        date: formatDateLocal(latestBP.date),
        systolic:
          latestBP.measureCount <= 1
            ? latestBP.highSystolic
            : Math.round((latestBP.highSystolic + latestBP.lowSystolic) / 2),
        diastolic:
          latestBP.measureCount <= 1
            ? latestBP.highDiastolic
            : Math.round(
                (latestBP.highDiastolic + latestBP.lowDiastolic) / 2
              ),
        pulse: latestBP.avgPulse,
        category: latestBP.category,
      }
    : null;

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
      latestBP={latestBPDisplay}
      bpTrend={bpRecords.map((r) => ({
        date: formatDateLocal(r.date),
        systolic: Math.round((r.highSystolic + r.lowSystolic) / 2),
        diastolic: Math.round((r.highDiastolic + r.lowDiastolic) / 2),
        pulse: r.avgPulse,
        category: r.category,
      }))}
      bpCorrelation={bpCorrelation}
    />
  );
}

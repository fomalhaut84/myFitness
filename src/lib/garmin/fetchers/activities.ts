import type { GarminConnect } from "@flow-js/garmin-connect";
import { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { computeIntensityFromRawData } from "@/lib/fitness/intensity";
import { resolveLTHR } from "@/lib/fitness/zones";
import { withRateLimit } from "../utils";

const PAGE_SIZE = 20;

export async function syncActivities(
  client: GarminConnect,
  startDate: Date,
  endDate: Date
): Promise<number> {
  let synced = 0;
  let start = 0;
  let hasMore = true;

  // M4-5: 강도 분류 시 사용할 LTHR (프로필에서 1회 조회, 없으면 추정)
  const profile = await prisma.userProfile.findFirst();
  const lthr = profile ? resolveLTHR(profile) : null;

  while (hasMore) {
    const activities = await withRateLimit(() =>
      client.getActivities(start, PAGE_SIZE)
    );

    if (activities.length === 0) {
      hasMore = false;
      break;
    }

    for (const a of activities) {
      const activityDate = new Date(a.startTimeLocal || a.startTimeGMT);

      if (activityDate < startDate) {
        hasMore = false;
        break;
      }

      // endDate는 해당 날짜 자정이므로, 하루 끝(+24h)까지 포함
      const endOfDay = new Date(endDate.getTime() + 24 * 60 * 60 * 1000);
      if (activityDate > endOfDay) {
        continue;
      }

      const raw = a as unknown as Record<string, unknown>;
      const summaryDTO = raw.summaryDTO as Record<string, unknown> | undefined;

      const data = {
        activityType: a.activityType?.typeKey ?? "unknown",
        name: a.activityName ?? "Untitled",
        startTime: activityDate,
        duration: Math.round(a.duration ?? 0),
        distance: a.distance ?? null,
        calories: a.calories ? Math.round(a.calories) : null,
        avgHR: a.averageHR ? Math.round(a.averageHR) : null,
        maxHR: a.maxHR ? Math.round(a.maxHR) : null,
        avgPace:
          a.distance && a.duration && a.distance > 0
            ? a.duration / (a.distance / 1000)
            : null,
        avgSpeed: a.averageSpeed ? a.averageSpeed * 3.6 : null,
        elevationGain: a.elevationGain ?? null,
        trainingEffect: (summaryDTO?.trainingEffect as number) ?? null,
        vo2maxEstimate: (raw.vO2MaxValue as number) ?? null,
        // M2: 러닝 다이나믹스
        avgCadence: toInt(summaryDTO?.averageRunCadence),
        avgStrideLength: toFloat(summaryDTO?.strideLength),
        avgVerticalOscillation: toFloat(summaryDTO?.verticalOscillation),
        avgGroundContactTime: toFloat(summaryDTO?.groundContactTime),
        aerobicTE: toFloat(summaryDTO?.trainingEffect),
        anaerobicTE: toFloat(summaryDTO?.anaerobicTrainingEffect),
        avgRespirationRate: toFloat(raw.avgRespirationRate),
        lapCount: toInt(raw.lapCount),
        splitSummaries: a.splitSummaries
          ? (a.splitSummaries as Prisma.InputJsonValue)
          : Prisma.DbNull,
        rawData: raw as Prisma.InputJsonValue,
      };

      // M4-5: 강도 자동 분류 (hrTimeInZone_1~5 기반)
      const intensity = computeIntensityFromRawData({
        rawData: raw,
        avgHR: data.avgHR,
        lthr,
      });
      const intensityData = intensity
        ? {
            zoneDistribution: intensity.zoneDistribution as unknown as Prisma.InputJsonValue,
            estimatedZone: intensity.estimatedZone,
            intensityScore: intensity.intensityScore,
            intensityLabel: intensity.intensityLabel,
          }
        : {
            zoneDistribution: Prisma.DbNull,
            estimatedZone: null,
            intensityScore: null,
            intensityLabel: null,
          };

      await prisma.activity.upsert({
        where: { garminId: BigInt(a.activityId) },
        update: { ...data, ...intensityData },
        create: { garminId: BigInt(a.activityId), ...data, ...intensityData },
      });

      synced++;
    }

    start += PAGE_SIZE;
  }

  return synced;
}

function toInt(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isNaN(n) ? null : Math.round(n);
}

function toFloat(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

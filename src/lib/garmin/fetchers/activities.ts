import type { GarminConnect } from "@flow-js/garmin-connect";
import { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { computeIntensityFromRawData } from "@/lib/fitness/intensity";
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

  // M4-5: 강도 분류 시 사용할 실측 LTHR (프로필에서 1회 조회).
  // 실측값이 없으면 LTHR 기반 보정은 건너뛰고 분포만으로 분류.
  const profile = await prisma.userProfile.findFirst();
  const lthr = profile?.lthr ?? null;

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

      // M4-5: 강도 자동 분류 (hrTimeInZone_1~5 기반).
      // 분포 추출 실패 시 기존 값을 덮어쓰지 않도록 update/create 동작을 분리.
      const intensity = computeIntensityFromRawData({
        rawData: raw,
        avgHR: data.avgHR,
        lthr,
      });
      const intensityData: Record<string, unknown> = intensity
        ? {
            zoneDistribution: intensity.zoneDistribution as unknown as Prisma.InputJsonValue,
            estimatedZone: intensity.estimatedZone,
            intensityScore: intensity.intensityScore,
            intensityLabel: intensity.intensityLabel,
          }
        : {};
      // create 시에만 빈 값 명시 (upsert update에서는 생략하여 기존 값 유지)
      const intensityDataCreate: Record<string, unknown> = intensity
        ? intensityData
        : {
            zoneDistribution: Prisma.DbNull,
            estimatedZone: null,
            intensityScore: null,
            intensityLabel: null,
          };

      await prisma.activity.upsert({
        where: { garminId: BigInt(a.activityId) },
        update: { ...data, ...intensityData },
        create: { garminId: BigInt(a.activityId), ...data, ...intensityDataCreate },
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

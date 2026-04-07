import type { GarminConnect } from "@flow-js/garmin-connect";
import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
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

      if (activityDate > endDate) {
        continue;
      }

      // IActivity 타입에 없는 필드는 any 캐스팅
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
        rawData: raw as Prisma.InputJsonValue,
      };

      await prisma.activity.upsert({
        where: { garminId: BigInt(a.activityId) },
        update: data,
        create: { garminId: BigInt(a.activityId), ...data },
      });

      synced++;
    }

    start += PAGE_SIZE;
  }

  return synced;
}

import type { GarminConnect } from "@flow-js/garmin-connect";
import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { dateRange, isNoDataError, startOfDay, withRateLimit } from "../utils";

export async function syncHeartRate(
  client: GarminConnect,
  startDate: Date,
  endDate: Date
): Promise<number> {
  let synced = 0;
  const dates = dateRange(startDate, endDate);

  for (const date of dates) {
    try {
      const hrData = await withRateLimit(() => client.getHeartRate(date));

      if (!hrData) continue;

      const raw = hrData as unknown as Record<string, unknown>;
      const dayDate = startOfDay(date);

      // getSleepData에서 HRV 정보 가져옴
      let hrvStatus: number | null = null;
      try {
        const sleepData = await client.getSleepData(date);
        hrvStatus = sleepData?.avgOvernightHrv ?? null;
      } catch {
        // HRV 데이터 없음
      }

      const data = {
        restingHR: toInt(raw.restingHeartRate),
        avgHR: extractAvgHR(raw),
        maxHR: toInt(raw.maxHeartRate),
        minHR: toInt(raw.minHeartRate),
        hrvStatus,
        hrvBaseline: null as number | null,
        rawData: raw as Prisma.InputJsonValue,
      };

      await prisma.heartRateRecord.upsert({
        where: { date: dayDate },
        update: data,
        create: { date: dayDate, ...data },
      });

      synced++;
    } catch (error) {
      if (isNoDataError(error)) continue;
      throw error;
    }
  }

  return synced;
}

function toInt(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isNaN(n) ? null : Math.round(n);
}

function extractAvgHR(raw: Record<string, unknown>): number | null {
  const values = raw.heartRateValues as Array<[number, number]> | undefined;
  if (!values || values.length === 0) return null;

  const validValues = values
    .map(([, hr]) => hr)
    .filter((hr) => hr > 0);

  if (validValues.length === 0) return null;

  const sum = validValues.reduce((acc, hr) => acc + hr, 0);
  return Math.round(sum / validValues.length);
}

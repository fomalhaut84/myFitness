import type { GarminConnect } from "@flow-js/garmin-connect";
import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { dateRange, isNoDataError, startOfDay, withRateLimit } from "../utils";

export async function syncSleep(
  client: GarminConnect,
  startDate: Date,
  endDate: Date
): Promise<number> {
  let synced = 0;
  const dates = dateRange(startDate, endDate);

  for (const date of dates) {
    try {
      const sleepData = await withRateLimit(() => client.getSleepData(date));

      if (!sleepData?.dailySleepDTO) continue;

      const dto = sleepData.dailySleepDTO;

      // GMT 타임스탬프 사용 (Local은 가짜 epoch이라 타임존 변환 시 틀어짐)
      if (!dto.sleepStartTimestampGMT || !dto.sleepEndTimestampGMT) continue;

      const dayDate = startOfDay(date);

      const data = {
        sleepStart: new Date(dto.sleepStartTimestampGMT),
        sleepEnd: new Date(dto.sleepEndTimestampGMT),
        totalSleep: Math.round(dto.sleepTimeSeconds / 60),
        deepSleep: dto.deepSleepSeconds
          ? Math.round(dto.deepSleepSeconds / 60)
          : null,
        lightSleep: dto.lightSleepSeconds
          ? Math.round(dto.lightSleepSeconds / 60)
          : null,
        remSleep: dto.remSleepSeconds
          ? Math.round(dto.remSleepSeconds / 60)
          : null,
        awakeDuration: dto.awakeSleepSeconds
          ? Math.round(dto.awakeSleepSeconds / 60)
          : null,
        sleepScore: dto.sleepScores?.overall?.value ?? null,
        avgSpO2: null as number | null,
        rawData: sleepData as unknown as Prisma.InputJsonValue,
      };

      await prisma.sleepRecord.upsert({
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

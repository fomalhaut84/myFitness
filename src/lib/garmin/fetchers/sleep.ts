import type { GarminConnect } from "@flow-js/garmin-connect";
import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { dateRange, startOfDay, withRateLimit } from "../utils";

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

      if (!dto.sleepStartTimestampLocal || !dto.sleepEndTimestampLocal) continue;

      const dayDate = startOfDay(date);

      const data = {
        sleepStart: new Date(dto.sleepStartTimestampLocal),
        sleepEnd: new Date(dto.sleepEndTimestampLocal),
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
    } catch {
      // 해당 날짜 수면 데이터 없음 → 건너뜀
    }
  }

  return synced;
}

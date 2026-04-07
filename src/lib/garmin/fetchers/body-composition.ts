import type { GarminConnect } from "@flow-js/garmin-connect";
import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { dateRange, startOfDay, withRateLimit } from "../utils";

export async function syncBodyComposition(
  client: GarminConnect,
  startDate: Date,
  endDate: Date
): Promise<number> {
  let synced = 0;
  const dates = dateRange(startDate, endDate);

  for (const date of dates) {
    try {
      const weightData = await withRateLimit(() =>
        client.getDailyWeightData(date)
      );

      if (!weightData) continue;

      const raw = weightData as unknown as Record<string, unknown>;
      const weight = extractWeight(raw);

      if (weight === null) continue;

      const dayDate = startOfDay(date);

      const data = {
        weight,
        bmi: toFloat(raw.bmi),
        bodyFat: toFloat(raw.bodyFat),
        muscleMass: toFloat(raw.muscleMass),
        rawData: raw as Prisma.InputJsonValue,
      };

      await prisma.bodyComposition.upsert({
        where: { date: dayDate },
        update: data,
        create: { date: dayDate, ...data },
      });

      synced++;
    } catch {
      // 해당 날짜 체중 데이터 없음 → 건너뜀
    }
  }

  return synced;
}

function toFloat(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function extractWeight(raw: Record<string, unknown>): number | null {
  const w = raw.weight as number | undefined;
  if (w === null || w === undefined) return null;

  // 1000 이상이면 gram → kg 변환
  if (w > 1000) return Math.round((w / 1000) * 10) / 10;
  return Math.round(w * 10) / 10;
}

import type { GarminConnect } from "@flow-js/garmin-connect";
import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { dateRange, formatDate, startOfDay, withRateLimit } from "../utils";

const STATS_BASE = "https://connectapi.garmin.com/usersummary-service/stats";

interface StatsResult {
  calendarDate: string;
  totalSteps?: number;
  values?: Record<string, number>;
  [key: string]: unknown;
}

async function fetchStat(
  client: GarminConnect,
  type: string,
  dateStr: string
): Promise<StatsResult | null> {
  try {
    const results = await client.get<StatsResult[]>(
      `${STATS_BASE}/${type}/daily/${dateStr}/${dateStr}`
    );
    return results?.[0] ?? null;
  } catch {
    return null;
  }
}

export async function syncDailySummaries(
  client: GarminConnect,
  startDate: Date,
  endDate: Date
): Promise<number> {
  let synced = 0;
  const dates = dateRange(startDate, endDate);

  for (const date of dates) {
    try {
      const dateStr = formatDate(date);

      // 4개 stats API 병렬 호출 후 rate limit 대기
      const [steps, calories, stress, heartRate, floors] = await withRateLimit(
        () =>
          Promise.all([
            fetchStat(client, "steps", dateStr),
            fetchStat(client, "calories", dateStr),
            fetchStat(client, "stress", dateStr),
            fetchStat(client, "heartRate", dateStr),
            fetchStat(client, "floors", dateStr),
          ])
      );

      // 모든 API가 null이면 데이터 없음
      if (!steps && !calories && !stress && !heartRate) continue;

      const dayDate = startOfDay(date);

      const data = {
        steps: steps?.totalSteps ?? null,
        totalCalories: calories?.values?.totalCalories ?? null,
        activeCalories: calories?.values?.activeCalories ?? null,
        restingHR: heartRate?.values?.restingHR ?? null,
        avgStress: stress?.values?.overallStressLevel ?? null,
        bodyBattery: null as number | null,
        bodyBatteryHigh: null as number | null,
        bodyBatteryLow: null as number | null,
        intensityMin: null as number | null,
        floorsClimbed: floors?.values?.wellnessFloorsAscended ?? null,
        rawData: {
          steps,
          calories,
          stress,
          heartRate,
          floors,
        } as Prisma.InputJsonValue,
      };

      await prisma.dailySummary.upsert({
        where: { date: dayDate },
        update: data,
        create: { date: dayDate, ...data },
      });

      synced++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[daily-summary] ${formatDate(date)} 싱크 실패:`, msg);
    }
  }

  return synced;
}

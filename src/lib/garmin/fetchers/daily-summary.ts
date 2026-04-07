import type { GarminConnect } from "@flow-js/garmin-connect";
import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { dateRange, formatDate, startOfDay, withRateLimit } from "../utils";

const DAILY_SUMMARY_URL =
  "https://connectapi.garmin.com/usersummary-service/usersummary/daily";

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
      const summary = await withRateLimit(() =>
        client.get<Record<string, unknown>>(
          `${DAILY_SUMMARY_URL}?calendarDate=${dateStr}`
        )
      );

      if (!summary || !summary.calendarDate) continue;

      const dayDate = startOfDay(date);
      const moderate = toInt(summary.moderateIntensityMinutes);
      const vigorous = toInt(summary.vigorousIntensityMinutes);
      const intensityMin =
        moderate !== null || vigorous !== null
          ? (moderate ?? 0) + (vigorous ?? 0)
          : null;

      const data = {
        steps: toInt(summary.totalSteps),
        totalCalories: toInt(summary.totalKilocalories),
        activeCalories: toInt(summary.activeKilocalories),
        restingHR: toInt(summary.restingHeartRate),
        avgStress: toInt(summary.averageStressLevel),
        bodyBattery: toInt(summary.bodyBatteryMostRecentValue),
        bodyBatteryHigh: toInt(summary.bodyBatteryHighestValue),
        bodyBatteryLow: toInt(summary.bodyBatteryLowestValue),
        intensityMin,
        floorsClimbed: toInt(summary.floorsAscended),
        rawData: summary as Prisma.InputJsonValue,
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

function toInt(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isNaN(n) ? null : Math.round(n);
}
